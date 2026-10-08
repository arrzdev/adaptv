// @vitest-environment node
import { spawn } from "node:child_process"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"
import { create } from "../packages/create-adaptv/create.mjs"
import { ensureDist } from "../scripts/ensure-dist.mjs"

/*
 * `examples/basic` is what the README quick start runs: the app `create-adaptv` writes,
 * installed from this checkout's `pnpm pack` tarball. Two things drift silently: the
 * tarball name carries the version, and the patches the app carries carry theirs.
 * Either one stale fails the quick start at `pnpm install`, which no other suite runs.
 * The patches are the template's, and `create.test.mjs` holds those to the repo's.
 *
 * The example also pins the repo's pnpm in `packageManager`, which a created app does not:
 * copied out of the repo, it would otherwise install with whatever pnpm is global.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const EXAMPLE = join(ROOT, "examples/basic")
const read = (dir, file) => readFileSync(join(dir, file), "utf8")
const rootPkg = JSON.parse(read(ROOT, "package.json"))
const TARBALL = `file:../../adaptv-${rootPkg.version}.tgz`

/** `package.json` as create-adaptv writes it: the example's, without its pnpm pin. */
function unpinned(text) {
  const { packageManager: _, ...pkg } = JSON.parse(text)
  return `${JSON.stringify(pkg, null, 2)}\n`
}

/** Every file under `dir`, relative to it, skipping what an install or a build writes. */
function files(dir, at = dir) {
  return readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
    const path = join(at, entry.name)
    if (entry.isDirectory())
      return ["node_modules", ".adaptv", ".output", "dist"].includes(
        entry.name,
      )
        ? []
        : files(dir, path)
    return [relative(dir, path)]
  })
}

const temp = mkdtempSync(join(tmpdir(), "examples-basic-"))
afterAll(() => rmSync(temp, { recursive: true, force: true }))

describe("examples/basic", () => {
  it("installs the tarball `pnpm pack` writes for this version", () => {
    const pkg = JSON.parse(read(EXAMPLE, "package.json"))
    expect(pkg.dependencies["adaptv"]).toBe(TARBALL)
  })

  it("pins the pnpm this repo uses", () => {
    const pkg = JSON.parse(read(EXAMPLE, "package.json"))
    expect(pkg.packageManager).toBe(rootPkg.packageManager)
  })

  it("is the app create-adaptv writes, patches included", () => {
    const created = join(temp, "basic")
    create({ dir: created, name: "basic", adaptv: TARBALL })
    const ignored = [".gitignore", "pnpm-lock.yaml"]
    const ours = files(EXAMPLE).filter((f) => !ignored.includes(f))
    expect(ours.sort()).toEqual(
      files(created)
        .filter((f) => !ignored.includes(f))
        .sort(),
    )
    for (const file of ours)
      expect(
        file === "package.json"
          ? unpinned(read(EXAMPLE, file))
          : read(EXAMPLE, file),
        file,
      ).toBe(read(created, file))
  })
})

/** A port nothing listens on, from the OS. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "localhost", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * `examples/basic`, outside this repo, serves its page from `adaptv dev web`.
 *
 * Outside is the point: inside, resolution walks up to the repo's own `node_modules` and
 * finds TanStack, which the app does not have. The dev server render resolves the imports
 * TanStack writes into the app's route modules from the app, so every page was a 500
 * (`src/vite/tanstack-resolve.ts`). There is no install — the network is not the gate's to
 * need — so the copy's `node_modules` holds links: the framework to this checkout, each
 * dependency to the copy the framework resolves, as `packages/create-adaptv` does.
 */
//a cold dev server's first render, on a host running every other suite at once
const DEV_TIMEOUT = 240_000

describe("examples/basic outside this repo", () => {
  it(
    "renders its page from adaptv dev web",
    async () => {
      expect(ensureDist(ROOT)).toBe(true)
      const app = join(temp, "outside/basic")
      cpSync(EXAMPLE, app, {
        recursive: true,
        filter: (src) =>
          ![".adaptv", ".output", "node_modules"].some((dir) =>
            src.startsWith(join(EXAMPLE, dir)),
          ),
      })
      const link = (name, target) => {
        mkdirSync(dirname(join(app, "node_modules", name)), {
          recursive: true,
        })
        symlinkSync(target, join(app, "node_modules", name), "dir")
      }
      const pkg = JSON.parse(read(EXAMPLE, "package.json"))
      for (const name of Object.keys(pkg.dependencies))
        link(
          name,
          name === "adaptv" ? ROOT : join(ROOT, "node_modules", name),
        )

      const port = await freePort()
      let output = ""
      const dev = spawn(
        process.execPath,
        [
          join(ROOT, "bin/adaptv.mjs"),
          "dev",
          "web",
          "--",
          "--port",
          String(port),
          "--strictPort",
        ],
        { cwd: app, env: { ...process.env, NO_COLOR: "1" } },
      )
      for (const stream of [dev.stdout, dev.stderr])
        stream.on("data", (chunk) => {
          output += chunk
        })
      const exited = new Promise((resolve) => dev.once("exit", resolve))
      try {
        let response
        while (!response && dev.exitCode === null) {
          response = await fetch(`http://localhost:${port}/`).catch(
            () => new Promise((resolve) => setTimeout(resolve, 500)),
          )
        }
        expect(response?.status, output).toBe(200)
        expect(await response.text()).toMatch(/<h1[^>]*>basic<\/h1>/)
      } finally {
        //the CLI stops vite's process group on SIGTERM
        dev.kill("SIGTERM")
        await exited
      }
    },
    DEV_TIMEOUT,
  )
})
