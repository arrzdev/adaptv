// @vitest-environment node
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { GLYPH as CLI_GLYPH } from "../../bin/ui/theme.mjs"
import {
  ADAPTV_VERSION,
  appIdFor,
  create,
  DEPENDENCIES,
  DEV_DEPENDENCIES,
  GLYPH,
  invalidName,
  packageManager,
  runCommand,
  SCRIPTS,
  TEMPLATE,
} from "./create.mjs"

/**
 * `pnpm create adaptv my-app` → docs/design/create-adaptv.md.
 *
 * The scaffolder ships alone, so everything it knows about the framework is a copy: the
 * version, the peers, the glyphs. Each copy is held to its source here. The last test is
 * the one that matters: a created app, outside this repo, passes `adaptv build web`.
 */

//cwd, not import.meta.url: vitest hands modules a non-`file:` URL.
const ROOT = process.cwd()
const INDEX = join(ROOT, "packages/create-adaptv/index.mjs")
const rootPkg = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
)

const dirs = []
afterAll(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "create-adaptv-"))
  dirs.push(dir)
  return dir
}

/** Every file under `dir`, app-relative and sorted. */
function files(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort()
}

function run(args, cwd, env = {}) {
  return spawnSync(process.execPath, [INDEX, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", ...env },
  })
}

describe("what it emits", () => {
  const dir = join(tempDir(), "my-app")
  create({ dir, name: "my-app" })
  const read = (file) => readFileSync(join(dir, file), "utf8")

  it("is a config, a vite config, one route and a stylesheet — nothing else", () => {
    expect(files(dir)).toEqual([
      ".gitignore",
      "adaptv.config.ts",
      "package.json",
      "pnpm-workspace.yaml",
      "src/routing/config.ts",
      "src/routing/pages/home.page.tsx",
      "src/styles/main.css",
      "tsconfig.json",
      "vite.config.ts",
    ])
  })

  it("writes a flat config named after the app", () => {
    const config = read("adaptv.config.ts")
    expect(config).toContain('name: "my-app"')
    expect(config).toContain('appId: "com.example.myapp"')
    expect(config).not.toMatch(/\bweb\s*:/)
    expect(config).not.toContain("__")
  })

  it("roots the route in a View", () => {
    expect(read("src/routing/pages/home.page.tsx")).toMatch(/<View[\s>]/)
  })

  it("calls adaptv() once in the vite config", () => {
    expect(read("vite.config.ts").match(/adaptv\(\)/g)).toHaveLength(1)
  })

  it("wires the scripts to the real CLI surface and depends on this release", () => {
    const pkg = JSON.parse(read("package.json"))
    expect(Object.keys(pkg.scripts)).toEqual([
      "doctor",
      "dev",
      "preview",
      "build",
    ])
    expect(pkg.scripts).toEqual(SCRIPTS)
    expect(pkg.dependencies["@arrzdev/adaptv"]).toBe(rootPkg.version)
  })

  it("refuses a directory that already holds something", () => {
    expect(() => create({ dir, name: "my-app" })).toThrow(
      "'my-app' already exists and is not empty",
    )
  })
})

describe("the copies it keeps of the framework", () => {
  it("depends on the framework's version", () => {
    expect(ADAPTV_VERSION).toBe(rootPkg.version)
  })

  it("pins every peer at the version the framework pins", () => {
    for (const [name, version] of Object.entries(rootPkg.peerDependencies))
      expect(DEPENDENCIES[name], name).toBe(version)
    for (const [name, version] of Object.entries({
      ...DEPENDENCIES,
      ...DEV_DEPENDENCIES,
    }))
      expect(rootPkg.devDependencies[name], name).toBe(version)
  })

  it("prints the CLI's glyphs", () => {
    expect(GLYPH).toEqual({ ok: CLI_GLYPH.ok, fail: CLI_GLYPH.fail })
  })

  it("ships no file the template does not need", () => {
    expect(readdirSync(TEMPLATE).sort()).toEqual([
      "adaptv.config.ts",
      "gitignore",
      "pnpm-workspace.yaml",
      "src",
      "tsconfig.json",
      "vite.config.ts",
    ])
  })
})

describe("names", () => {
  it("takes a lowercase package name and refuses anything else", () => {
    expect(invalidName("my-app")).toBeNull()
    expect(invalidName("app2.web")).toBeNull()
    for (const name of ["My App", "my app", "-app", "../app", "@me/app"])
      expect(invalidName(name), name).toMatch(/is not a valid app name/)
  })

  it("derives an app id both stores accept", () => {
    expect(appIdFor("my-app")).toBe("com.example.myapp")
    expect(appIdFor("2048")).toBe("com.example.app2048")
  })
})

describe("the package manager that ran it", () => {
  it("is read from the user agent, npm when there is none", () => {
    expect(packageManager("pnpm/11.1.1 npm/? node/v22.12.0")).toBe("pnpm")
    expect(packageManager("yarn/4.0.0")).toBe("yarn")
    expect(packageManager("bun/1.1.0")).toBe("bun")
    expect(packageManager(undefined)).toBe("npm")
  })

  it("runs a script the way that manager does", () => {
    expect(runCommand("pnpm", "dev")).toBe("pnpm dev")
    expect(runCommand("npm", "dev")).toBe("npm run dev")
  })
})

describe("the command", () => {
  const PNPM = { npm_config_user_agent: "pnpm/11.1.1 npm/? node/v22.12.0" }

  it("says it created the app and what to type next", () => {
    const cwd = tempDir()
    const result = run(["my-app"], cwd, PNPM)
    expect(result.status).toBe(0)
    expect(result.stdout).toBe(
      [
        "",
        "  adaptv · create my-app",
        "",
        "  ✓ created my-app",
        "",
        "    cd my-app",
        "    pnpm install",
        "    pnpm dev",
        "",
        "",
      ].join("\n"),
    )
    expect(existsSync(join(cwd, "my-app/adaptv.config.ts"))).toBe(true)
  })

  it("prints one ✖ that names the fix and exits 1", () => {
    const cwd = tempDir()
    const cases = [
      [[], "missing app name — 'pnpm create adaptv <name>'"],
      [["My App"], "'My App' is not a valid app name"],
      [["my-app", "--typescript"], "unknown option '--typescript'"],
    ]
    for (const [args, message] of cases) {
      const result = run(args, cwd, PNPM)
      expect(result.status, message).toBe(1)
      expect(result.stderr.match(/✖/g), message).toHaveLength(1)
      expect(result.stderr, message).toContain(`✖ ${message}`)
    }
    expect(readdirSync(cwd)).toEqual([])
  })
})

/**
 * The created app, outside this repo, passes `adaptv build web`.
 *
 * Outside is the point: inside it, resolution walks up to the repo's own `node_modules`
 * and finds what a real app would not (`src/vite/tanstack-resolve.ts`). There is no
 * install — the network is not the gate's to need — so the app's `node_modules` holds
 * links, the framework to this checkout and every other dependency to the copy the
 * framework itself resolves, which is what one install of each looks like.
 */
//a whole client + server build, on a host running every other suite at once
const BUILD_TIMEOUT = 240_000

describe("a created app", () => {
  it(
    "passes adaptv build web",
    () => {
      const dir = join(tempDir(), "my-app")
      create({ dir, name: "my-app", adaptv: `link:${ROOT}` })
      //before the links: a recursive walk follows them into the repo's whole dependency tree
      const before = Object.fromEntries(
        files(dir).map((f) => [f, readFileSync(join(dir, f), "utf8")]),
      )
      const link = (name, target) => {
        mkdirSync(dirname(join(dir, "node_modules", name)), {
          recursive: true,
        })
        symlinkSync(target, join(dir, "node_modules", name), "dir")
      }
      link("@arrzdev/adaptv", ROOT)
      for (const name of Object.keys(DEPENDENCIES))
        link(name, join(ROOT, "node_modules", name))

      const result = spawnSync(
        process.execPath,
        [join(ROOT, "bin/adaptv.mjs"), "build", "web"],
        {
          cwd: dir,
          encoding: "utf8",
          env: { ...process.env, NO_COLOR: "1" },
        },
      )

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      expect(result.stdout).toContain("✓ web  .output/public")
      expect(existsSync(join(dir, ".output/public"))).toBe(true)
      //the build stamps a tsconfig, an ignore list and a layer order into an app that
      //lacks them; a created app already has all three, so nothing it was given moved
      for (const [file, text] of Object.entries(before))
        expect(readFileSync(join(dir, file), "utf8"), file).toBe(text)
    },
    BUILD_TIMEOUT,
  )
})
