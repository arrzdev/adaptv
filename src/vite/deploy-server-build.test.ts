// @vitest-environment node
import { createHash } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { adaptvShellEmitPlugin } from "#adaptv/vite/shell-emit.ts"
import { adaptvSwBuildPlugin } from "#adaptv/vite/sw-build.ts"

/*
 * The shell and the worker are in the server's public asset table.
 * → `deploy-server.ts` (`emitIntoClientOutput`)
 *
 * Nitro's node-server preset serves static files from a table it bakes into the
 * server bundle, listing whatever is in `.output/public` when that bundle is
 * built. The two emitters used to write after it, so `node .output/server/index.mjs`
 * answered 404 for `/sw.js` and `/adaptv-shell.html` while both sat on disk, and
 * a production SSR app never installed its worker. `vite preview` reads the
 * directory instead, which is why the service-worker suites never saw it. A real
 * Nitro build, because only Nitro can say when it reads the directory.
 */

const roots: string[] = []
afterAll(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

//a client build, a Nitro build, the boot fallback prerender (React) and the
//worker bundle, while the gate runs every other suite in parallel
const BUILD_TIMEOUT = 180_000

let appRoot: string
let serverEntry: string
let worker: string

beforeAll(async () => {
  appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-deploy-server-build-"))
  roots.push(appRoot)
  //the prerender resolves React from the APP (register B31), linked the way pnpm would
  mkdirSync(path.join(appRoot, "node_modules"))
  for (const pkg of ["react", "react-dom"])
    symlinkSync(
      path.join(process.cwd(), "node_modules", pkg),
      path.join(appRoot, "node_modules", pkg),
      "dir",
    )
  mkdirSync(path.join(appRoot, "src/routing"), { recursive: true })
  writeFileSync(path.join(appRoot, "entry.js"), "export const app = 1\n")
  //copied in by Nitro, not by the client build: the precache has to see it, so
  //the emitters cannot simply run earlier than the copy either
  mkdirSync(path.join(appRoot, "public"))
  writeFileSync(path.join(appRoot, "public/robots.txt"), "User-agent: *\n")

  const context: AdaptvContext = {
    appRoot,
    target: "web",
    web: { render: "ssr", sw: { enabled: true } },
    loaded: {
      watchFiles: [],
      config: {
        name: "Probe",
        description: "fixture",
        themeColor: { light: "#f0f0f0", dark: "#101010" },
        styles: "./src/styles/main.css",
        router: {},
      },
    },
  }

  const { createBuilder } = await import("vite")
  const { nitro } = await import("nitro/vite")
  const builder = await createBuilder({
    root: appRoot,
    configFile: false,
    logLevel: "silent",
    //the preset is named so the platform the gate happens to run on cannot pick
    //another one; `adaptvDeployServerPlugins` passes none
    plugins: [
      nitro({ preset: "node-server", logLevel: 0 }),
      adaptvShellEmitPlugin(context),
      adaptvSwBuildPlugin(context),
    ],
    environments: {
      client: {
        build: {
          rollupOptions: { input: path.join(appRoot, "entry.js") },
        },
      },
    },
  })
  await builder.buildApp()
  serverEntry = readFileSync(
    path.join(appRoot, ".output/server/index.mjs"),
    "utf8",
  )
  worker = readFileSync(path.join(appRoot, ".output/public/sw.js"), "utf8")
}, BUILD_TIMEOUT)

/** The public asset table's keys, as Nitro bakes them into the server entry. */
function servedPaths(): string[] {
  return [...serverEntry.matchAll(/^\s*"(\/[^"]*)": \{$/gm)].map(
    (match) => match[1] as string,
  )
}

describe("the node server's public asset table", () => {
  it("serves the worker and the shell, not just what was on disk before them", () => {
    const served = servedPaths()
    //the control: a file Nitro copied in itself, so an empty parse cannot pass
    expect(served).toContain("/robots.txt")
    expect(served).toContain("/sw.js")
    expect(served).toContain("/adaptv-shell.html")
  })

  it("lists the worker with a JavaScript type, so a browser will register it", () => {
    const start = serverEntry.indexOf('"/sw.js": {')
    expect(start, "/sw.js is not in the table").toBeGreaterThan(-1)
    const entry = serverEntry.slice(start)
    expect(entry.slice(0, entry.indexOf("}"))).toMatch(
      /"type": "text\/javascript/,
    )
  })

  it("still precaches what Nitro copied in, and the shell", () => {
    //emitting before the copy would pass the two tests above with a worker
    //missing every file from `public/` (the 21-file regression)
    const urls = [...worker.matchAll(/"url":"([^"]+)"/g)].map(
      (match) => match[1],
    )
    expect(urls).toContain("robots.txt")
    expect(urls).toContain("adaptv-shell.html")
  })

  it("precaches the shell at the revision of the file that ships", () => {
    //the worker is stamped after the shell is written; a shell rewritten later
    //would install a precache whose revision never matches what the server sends
    const shell = readFileSync(
      path.join(appRoot, ".output/public/adaptv-shell.html"),
    )
    const revision = worker.match(
      /\{"revision":"([0-9a-f]+)","url":"adaptv-shell\.html"\}/,
    )?.[1]
    expect(revision).toBe(createHash("md5").update(shell).digest("hex"))
  })
})
