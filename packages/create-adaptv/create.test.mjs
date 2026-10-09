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
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { GLYPH as CLI_GLYPH } from "../../bin/ui/theme.mjs"
import { ensureDist } from "../../scripts/ensure-dist.mjs"
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

  it("is a config, a vite config, one route, a stylesheet and the patches — nothing else", () => {
    expect(files(dir)).toEqual([
      ".gitignore",
      "adaptv.config.ts",
      "package.json",
      "patches/@capacitor__cli@8.4.3.patch",
      "patches/@capawesome__capacitor-live-update@8.3.0.patch",
      "patches/native-run@2.0.3.patch",
      "pnpm-workspace.yaml",
      "src/routing/config.ts",
      "src/routing/pages/home.page.tsx",
      "src/styles/main.css",
      "tsconfig.json",
      "vite.config.ts",
    ])
  })

  //L20: the engine underneath is adaptv's business. adaptv edits it as Node loads it
  //(src/vite/engine-hooks.ts), so the app carries no patch, key or file that names it.
  it("names the route engine in no file", () => {
    for (const file of files(dir))
      expect(`${file}\n${read(file)}`, file).not.toMatch(/tanstack/i)
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

  //styling.md §0.1: Tailwind left the framework's peers, not the template. A new app
  //styles with Tailwind 4 and adaptv's tailwind.css, and lists Tailwind as its own.
  it("styles with tailwind, which the app depends on and the framework does not", () => {
    expect(read("vite.config.ts")).toMatch(
      /^import tailwindcss from "@tailwindcss\/vite"$/m,
    )
    expect(read("vite.config.ts")).toContain(
      "plugins: [adaptv(), tailwindcss()]",
    )
    expect(read("src/styles/main.css").split("\n").slice(0, 3)).toEqual([
      "@layer theme, base, adaptv, components, utilities;",
      '@import "tailwindcss";',
      '@import "adaptv/tailwind.css";',
    ])
    expect(read("src/routing/pages/home.page.tsx")).toContain(
      "p-safe-offset-6",
    )
    const pkg = JSON.parse(read("package.json"))
    for (const name of ["tailwindcss", "@tailwindcss/vite"]) {
      expect(pkg.dependencies[name], name).toBe(
        rootPkg.devDependencies[name],
      )
      expect(rootPkg.peerDependencies[name], name).toBeUndefined()
    }
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
    expect(pkg.dependencies["adaptv"]).toBe(rootPkg.version)
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

  it("needs the Node the framework needs", () => {
    const own = JSON.parse(
      readFileSync(
        join(ROOT, "packages/create-adaptv/package.json"),
        "utf8",
      ),
    )
    expect(own.engines.node).toBe(rootPkg.engines.node)
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

  it("carries every patch the framework applies, byte for byte, and declares it", () => {
    //pnpm applies patches only from the project it installs, so the app holds its own
    //copy (docs/design/create-adaptv.md §4). A bumped patch must be copied here too.
    const patches = (yaml) =>
      Object.fromEntries(
        [
          ...(yaml.split(/^patchedDependencies:\n/m)[1] ?? "").matchAll(
            /^ {2}'([^']+)': (\S+)$/gm,
          ),
        ].map((m) => [m[1], m[2]]),
      )
    const ours = patches(
      readFileSync(join(TEMPLATE, "pnpm-workspace.yaml"), "utf8"),
    )
    expect(Object.keys(ours).length).toBeGreaterThan(0)
    expect(ours).toEqual(
      patches(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8")),
    )
    expect(readdirSync(join(TEMPLATE, "patches")).sort()).toEqual(
      readdirSync(join(ROOT, "patches")).sort(),
    )
    for (const file of Object.values(ours))
      expect(readFileSync(join(TEMPLATE, file), "utf8"), file).toBe(
        readFileSync(join(ROOT, file), "utf8"),
      )
  })

  it("prints the CLI's glyphs", () => {
    expect(GLYPH).toEqual({ ok: CLI_GLYPH.ok, fail: CLI_GLYPH.fail })
  })

  it("ships no file the template does not need", () => {
    expect(readdirSync(TEMPLATE).sort()).toEqual([
      "adaptv.config.ts",
      "gitignore",
      "patches",
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

/** A created app outside this repo, its `node_modules` linked as one install would leave it. */
function linkedApp() {
  const dir = join(tempDir(), "my-app")
  create({ dir, name: "my-app", adaptv: `link:${ROOT}` })
  const link = (name, target) => {
    mkdirSync(dirname(join(dir, "node_modules", name)), {
      recursive: true,
    })
    symlinkSync(target, join(dir, "node_modules", name), "dir")
  }
  const build = () =>
    spawnSync(
      process.execPath,
      [join(ROOT, "bin/adaptv.mjs"), "build", "web"],
      {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, NO_COLOR: "1" },
      },
    )
  return { dir, link, build }
}

describe("a created app", () => {
  it(
    "passes adaptv build web",
    () => {
      //the app resolves the framework through `exports`, which name `dist/`: build it
      //if `src/` moved since, or this checks whatever build happens to be lying around
      expect(ensureDist(ROOT)).toBe(true)
      const { dir, link, build } = linkedApp()
      //a page written without its import: the route generator adds it, and adaptv's
      //edit to the engine (src/vite/engine-hooks.ts) makes it name adaptv. The repo's
      //engine is installed unpatched, so this goes through the hook or fails.
      const about = "src/routing/pages/about.page.tsx"
      writeFileSync(
        join(dir, about),
        'export const Route = createFileRoute("/about")({ component: () => null })\n',
      )
      writeFileSync(
        join(dir, "src/routing/config.ts"),
        readFileSync(join(dir, "src/routing/config.ts"), "utf8")
          .replace("{ index,", "{ index, route,")
          .replace(
            'index("pages/home.page.tsx")',
            'index("pages/home.page.tsx"), route("/about", "pages/about.page.tsx")',
          ),
      )
      //before the links: a recursive walk follows them into the repo's whole dependency tree
      const before = Object.fromEntries(
        files(dir)
          .filter((f) => f !== about)
          .map((f) => [f, readFileSync(join(dir, f), "utf8")]),
      )
      link("adaptv", ROOT)
      for (const name of Object.keys(DEPENDENCIES))
        link(name, join(ROOT, "node_modules", name))

      const result = build()

      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      expect(result.stdout).toContain("✓ web  .output/public")
      expect(existsSync(join(dir, ".output/public"))).toBe(true)
      //the build stamps a tsconfig, an ignore list and a layer order into an app that
      //lacks them; a created app already has all three, so nothing it was given moved
      for (const [file, text] of Object.entries(before))
        expect(readFileSync(join(dir, file), "utf8"), file).toBe(text)
      expect(readFileSync(join(dir, about), "utf8")).toMatch(
        /^import \{ createFileRoute \} from ["']adaptv\/router["']$/m,
      )
      expect(readFileSync(join(dir, about), "utf8")).not.toMatch(
        /tanstack/i,
      )
      //`module.registerHooks` is release-candidate in Node 22: it must stay silent
      expect(result.stderr).not.toMatch(/ExperimentalWarning/)
      const html = files(join(dir, ".output/public")).filter((f) =>
        f.endsWith(".html"),
      )
      expect(html.length).toBeGreaterThan(0)
      for (const f of html)
        expect(
          readFileSync(join(dir, ".output/public", f), "utf8"),
          f,
        ).not.toMatch(/tanstack/i)
    },
    BUILD_TIMEOUT,
  )

  /*
   * adaptv's dependencies are not the app's (src/vite/engine-imports.ts). A pnpm install
   * keeps the router out of the app's `node_modules`, and adaptv resolved the import
   * anyway; an npm install hoists it there, and Node resolved it. Either way the build
   * passed. It now refuses both, and builds once the app lists the package as its own.
   */
  it(
    "imports a package adaptv depends on only once it lists it",
    () => {
      expect(ensureDist(ROOT)).toBe(true)
      const { dir, link, build } = linkedApp()
      link("adaptv", ROOT)
      for (const name of Object.keys(DEPENDENCIES))
        link(name, join(ROOT, "node_modules", name))
      const page = join(dir, "src/routing/pages/home.page.tsx")
      writeFileSync(
        page,
        `import { useRouter } from "@tanstack/react-router"\n${readFileSync(
          page,
          "utf8",
        ).replace(
          "function Home() {\n",
          "function Home() {\n  useRouter()\n",
        )}`,
      )
      const refused = (result) => {
        const out = `${result.stdout}\n${result.stderr}`
        expect(result.status, out).toBe(1)
        expect(out).toContain(
          "✖ web  src/routing/pages/home.page.tsx imports a package missing from the app's package.json",
        )
      }

      //pnpm: the router is adaptv's alone
      refused(build())
      //npm: hoisted next to the app's own packages
      link(
        "@tanstack/react-router",
        join(ROOT, "node_modules/@tanstack/react-router"),
      )
      refused(build())

      const pkgFile = join(dir, "package.json")
      const pkg = JSON.parse(readFileSync(pkgFile, "utf8"))
      pkg.dependencies["@tanstack/react-router"] =
        rootPkg.dependencies["@tanstack/react-router"]
      writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)
      const listed = build()
      expect(listed.status, `${listed.stdout}\n${listed.stderr}`).toBe(0)
      expect(listed.stdout).toContain("✓ web  .output/public")
    },
    BUILD_TIMEOUT,
  )
})
