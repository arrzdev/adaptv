// @vitest-environment node
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `cap.mjs` is the one door adaptv walks through to reach the native CLI, and it runs nothing
 * of its own: it resolves the CLI from adaptv's install, puts adaptv's `node_modules` on the
 * module path, reproduces the config patch when the installed copy does not carry it, and
 * calls the CLI's `run()`. Everything the dev sees on a native run starts here, and none of
 * it had a test, because the file is a script that acts on import.
 *
 * The seam is `node:module` and `node:fs`, mocked below, and each case re-imports the shim
 * fresh so its top-level work runs again under that case's env. Nothing here runs the real
 * CLI: `run()` is a spy in every case, including the one that loads upstream's real config
 * reader to prove the interception reproduces the patch.
 */

const ROOT = process.cwd()
/** Where the shim must say adaptv's modules live: the package root, three up from itself. */
const ADAPTV_MODULES = path.join(ROOT, "node_modules")
/** A CLI that does not exist on disk, for the cases that only need its shape. */
const FAKE_CLI = "/fake/adaptv/node_modules/@capacitor/cli"
const REAL_CONFIG_JS = path.join(
  ROOT,
  "node_modules/@capacitor/cli/dist/config.js",
)

const fake = vi.hoisted(() => ({
  /** "fake": the CLI is `FAKE_CLI`. "real": resolve and load the installed one. */
  mode: "fake",
  /** The CLI does not resolve from adaptv's install. */
  missing: false,
  /** What the shim reads as the CLI's `dist/config.js`. */
  configSource: "",
  /** @type {string[]} every anchor `createRequire` was handed */
  anchors: [],
  /** @type {string[]} every id the shim resolved */
  resolved: [],
  /** @type {string[]} every id the shim loaded */
  loaded: [],
  /** @type {string[]} every file the shim read */
  reads: [],
  /** @type {Array<string | undefined>} NODE_PATH as each `_initPaths` call saw it */
  initPaths: [],
  /** @type {any} */
  fsExtra: null,
  /** @type {any} */
  run: null,
}))

vi.mock("node:module", async (importOriginal) => {
  /** @type {typeof import("node:module")} */
  const actual = await importOriginal()
  const nodePath = await import("node:path")
  /** @param {string | URL} anchor */
  const createRequire = (anchor) => {
    fake.anchors.push(String(anchor))
    const real = actual.createRequire(anchor)
    /** @param {string} id */
    const req = (id) => {
      fake.loaded.push(id)
      if (id.endsWith(nodePath.join("dist", "index.js")))
        return { run: (...args) => fake.run(...args) }
      if (id === "fs-extra" && fake.mode === "fake") return fake.fsExtra
      return real(id)
    }
    /** @param {string} id */
    req.resolve = (id) => {
      fake.resolved.push(id)
      if (fake.missing) {
        const err = new Error(`Cannot find module '${id}'`)
        Object.assign(err, { code: "MODULE_NOT_FOUND" })
        throw err
      }
      return fake.mode === "real"
        ? real.resolve(id)
        : nodePath.join(FAKE_CLI, "package.json")
    }
    return req
  }
  const Module = {
    _initPaths: () => {
      fake.initPaths.push(process.env.NODE_PATH)
    },
  }
  return {
    ...actual,
    createRequire,
    Module,
    default: { ...actual, createRequire, Module },
  }
})

vi.mock("node:fs", async (importOriginal) => {
  /** @type {typeof import("node:fs")} */
  const actual = await importOriginal()
  /** @type {typeof actual.readFileSync} */
  const readFileSync = (file, ...rest) => {
    const p = String(file)
    if (p.endsWith("@capacitor/cli/dist/config.js")) {
      fake.reads.push(p)
      return fake.configSource
    }
    return actual.readFileSync(file, ...rest)
  }
  return {
    ...actual,
    readFileSync,
    default: { ...actual, readFileSync },
  }
})

/** A stand-in for the CLI's `fs-extra`, answering with what each original was asked. */
function fakeFsExtra() {
  const pathExists = vi.fn(async (p, ...rest) => ({
    original: "pathExists",
    p,
    rest,
  }))
  const readJSON = vi.fn(async (p, ...rest) => ({
    original: "readJSON",
    p,
    rest,
  }))
  return { pathExists, readJSON, originals: { pathExists, readJSON } }
}

/**
 * The source the patched CLI carries, and the same file with the patch reversed. Read through
 * the REAL `node:fs`: the mocked one answers the shim's sniff, not this.
 */
async function upstreamSources() {
  /** @type {typeof import("node:fs")} */
  const { readFileSync } = await vi.importActual("node:fs")
  const patched = readFileSync(REAL_CONFIG_JS, "utf8")
  const patch = readFileSync(
    path.join(ROOT, "patches/@capacitor__cli@8.4.3.patch"),
    "utf8",
  )
  const added = patch
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n")
  return { patched, unpatched: patched.replace(`${added}\n`, "") }
}

/**
 * Start the shim as a fresh process would: its env as given, then its top-level work.
 * NODE_PATH is always stubbed, so the shim's own write to it is undone after the case.
 * @param {Record<string, string | undefined>} env
 */
async function startShim(env = {}) {
  vi.stubEnv("NODE_PATH", undefined)
  vi.stubEnv("ADAPTV_CAPACITOR_CONFIG", undefined)
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  vi.resetModules()
  await import("./cap.mjs")
}

beforeEach(() => {
  fake.mode = "fake"
  fake.missing = false
  fake.configSource = "exports.loadConfig = async () => ({})"
  fake.anchors = []
  fake.resolved = []
  fake.loaded = []
  fake.reads = []
  fake.initPaths = []
  fake.fsExtra = fakeFsExtra()
  fake.run = vi.fn()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("which CLI the shim runs, and how", () => {
  it("resolves it from adaptv's own install and runs its entry once", async () => {
    const argv = [...process.argv]
    const before = process.exitCode
    process.exitCode = undefined
    let exitCode
    try {
      await startShim()
    } finally {
      exitCode = process.exitCode
      process.exitCode = before
    }
    //Anchored at the shim's own file, never at the app's cwd: the app declares no native
    //CLI (L20), so a lookup from the app root is the one that cannot find it.
    expect(fake.anchors[0]).toMatch(/bin\/lib\/cap\.mjs$/)
    expect(fake.resolved).toEqual(["@capacitor/cli/package.json"])
    expect(fake.loaded).toEqual([path.join(FAKE_CLI, "dist", "index.js")])
    expect(fake.run).toHaveBeenCalledTimes(1)
    expect(fake.run).toHaveBeenCalledWith()
    //The CLI parses process.argv itself, so the shim passes the dev's subcommand through by
    //leaving it alone, and leaves the exit code to the CLI it ran.
    expect(process.argv).toEqual(argv)
    expect(exitCode).toBeUndefined()
  })
})

describe("NODE_PATH: the native packages resolve from adaptv, not the app", () => {
  it("is set to adaptv's node_modules when nothing set it", async () => {
    await startShim()
    expect(process.env.NODE_PATH).toBe(ADAPTV_MODULES)
    //Setting the variable does nothing on its own: Node read it at startup.
    expect(fake.initPaths).toEqual([ADAPTV_MODULES])
  })

  it("is appended to what the launcher already set, keeping its order", async () => {
    const theirs = ["/somewhere/node_modules", "/else/node_modules"].join(
      path.delimiter,
    )
    await startShim({ NODE_PATH: theirs })
    expect(process.env.NODE_PATH).toBe(
      `${theirs}${path.delimiter}${ADAPTV_MODULES}`,
    )
    expect(fake.initPaths).toHaveLength(1)
  })

  it("is left alone when adaptv's modules are already on it", async () => {
    const already = ["/somewhere/node_modules", ADAPTV_MODULES].join(
      path.delimiter,
    )
    await startShim({ NODE_PATH: already })
    expect(process.env.NODE_PATH).toBe(already)
    expect(fake.initPaths).toEqual([])
  })

  it("is in effect before the CLI loads", async () => {
    fake.run = vi.fn(() => {
      expect(fake.initPaths).toEqual([ADAPTV_MODULES])
    })
    await startShim()
    expect(fake.run).toHaveBeenCalledTimes(1)
  })
})

describe("where the CLI reads its config from", () => {
  const CONFIG = {
    appId: "dev.adaptv.shim",
    appName: "Shim",
    webDir: "web",
  }

  it("changes nothing when adaptv handed it no config", async () => {
    const { pathExists, readJSON } = fake.fsExtra
    await startShim()
    expect(fake.reads).toEqual([])
    expect(fake.loaded).not.toContain("fs-extra")
    expect(fake.fsExtra.pathExists).toBe(pathExists)
    expect(fake.fsExtra.readJSON).toBe(readJSON)
  })

  it("treats an empty config as none, the way the patch does", async () => {
    //The patch tests the variable for truthiness, so the shim must too, or an unpatched
    //install would read an empty string as JSON and a patched one would ignore it.
    await startShim({ ADAPTV_CAPACITOR_CONFIG: "" })
    expect(fake.reads).toEqual([])
    expect(fake.loaded).not.toContain("fs-extra")
  })

  it("changes nothing on an install that already carries the patch", async () => {
    fake.configSource =
      "if (process.env.ADAPTV_CAPACITOR_CONFIG) { /* adaptv */ }"
    const { pathExists, readJSON } = fake.fsExtra
    await startShim({ ADAPTV_CAPACITOR_CONFIG: JSON.stringify(CONFIG) })
    expect(fake.reads).toEqual([path.join(FAKE_CLI, "dist", "config.js")])
    expect(fake.fsExtra.pathExists).toBe(pathExists)
    expect(fake.fsExtra.readJSON).toBe(readJSON)
    expect(fake.run).toHaveBeenCalledTimes(1)
  })

  describe("on an install without the patch", () => {
    beforeEach(async () => {
      fake.configSource = "exports.loadConfig = async () => ({})"
      await startShim({ ADAPTV_CAPACITOR_CONFIG: JSON.stringify(CONFIG) })
    })

    it("sniffs the CLI's own config reader, and takes the CLI's fs-extra", () => {
      expect(fake.reads).toEqual([
        path.join(FAKE_CLI, "dist", "config.js"),
      ])
      //From the CLI's package, not from adaptv: the interception only works on the
      //instance the config reader captured.
      expect(fake.anchors).toContain(path.join(FAKE_CLI, "package.json"))
      expect(fake.loaded).toContain("fs-extra")
    })

    it("reports the script configs absent, so the CLI takes its JSON branch", async () => {
      const fsx = fake.fsExtra
      expect(await fsx.pathExists("/app/capacitor.config.ts")).toBe(false)
      expect(await fsx.pathExists("/app/capacitor.config.js")).toBe(false)
      expect(fsx.originals.pathExists).not.toHaveBeenCalled()
    })

    it("serves the config adaptv handed it as the JSON file", async () => {
      const served = await fake.fsExtra.readJSON(
        "/app/capacitor.config.json",
      )
      expect(served).toEqual(CONFIG)
      expect(fake.fsExtra.originals.readJSON).not.toHaveBeenCalled()
    })

    it("passes every other read through untouched, arguments and all", async () => {
      const fsx = fake.fsExtra
      //The JSON config is asked about for real: the patch only replaces its CONTENT.
      expect(await fsx.pathExists("/app/capacitor.config.json")).toEqual({
        original: "pathExists",
        p: "/app/capacitor.config.json",
        rest: [],
      })
      expect(await fsx.pathExists("/app/Gemfile", "x")).toEqual({
        original: "pathExists",
        p: "/app/Gemfile",
        rest: ["x"],
      })
      expect(
        await fsx.readJSON("/app/package.json", { throws: false }),
      ).toEqual({
        original: "readJSON",
        p: "/app/package.json",
        rest: [{ throws: false }],
      })
      //A script config read as JSON is not the config file the patch replaces.
      expect(await fsx.readJSON("/app/capacitor.config.ts")).toEqual({
        original: "readJSON",
        p: "/app/capacitor.config.ts",
        rest: [],
      })
    })

    it("installs all of it before the CLI runs", () => {
      expect(fake.run).toHaveBeenCalledTimes(1)
      expect(fake.loaded.indexOf("fs-extra")).toBeLessThan(
        fake.loaded.indexOf(path.join(FAKE_CLI, "dist", "index.js")),
      )
    })
  })
})

/**
 * The interception is only worth anything if upstream's REAL config reader, unpatched, ends up
 * with the config adaptv handed it. A published consumer's copy is exactly that, and nothing
 * in this repo ever runs one, because the install here carries the patch. So the patch is
 * reversed in memory, upstream's reader is compiled from that source in place, and its answer
 * is compared with the patched reader's.
 */
describe("the patch it reproduces, against the real CLI", () => {
  const CONFIG = {
    appId: "dev.adaptv.published",
    appName: "Published",
    webDir: ".adaptv/web",
  }

  it("gives an unpatched reader the same config the patched one reads", async () => {
    /** @type {typeof import("node:module")} */
    const real = await vi.importActual("node:module")
    const requireCli = real.createRequire(REAL_CONFIG_JS)
    const fsx = requireCli("fs-extra")
    const saved = { pathExists: fsx.pathExists, readJSON: fsx.readJSON }
    const { patched, unpatched } = await upstreamSources()
    //The reversal has to have happened, or this compares the patch with itself.
    expect(patched).toContain("ADAPTV_CAPACITOR_CONFIG")
    expect(unpatched).not.toContain("ADAPTV_CAPACITOR_CONFIG")

    /** Upstream's reader, compiled from `source` where the real one lives. */
    const reader = (source) => {
      //`_nodeModulePaths` and `_compile` are Node's own loader internals: the same two steps
      //`require` takes, with the source handed in instead of read from disk.
      const m = new real.Module(REAL_CONFIG_JS)
      m.filename = REAL_CONFIG_JS
      m.paths = real.Module._nodeModulePaths(path.dirname(REAL_CONFIG_JS))
      m._compile(source, REAL_CONFIG_JS)
      return m.exports
    }

    try {
      vi.stubEnv("ADAPTV_CAPACITOR_CONFIG", JSON.stringify(CONFIG))
      //Control: unpatched and without the shim, the config adaptv handed over is not read.
      const without = await reader(unpatched).loadConfig()
      expect(without.app.appId).not.toBe(CONFIG.appId)

      fake.mode = "real"
      fake.configSource = unpatched
      await startShim({ ADAPTV_CAPACITOR_CONFIG: JSON.stringify(CONFIG) })
      expect(fake.run).toHaveBeenCalledTimes(1)
      expect(fsx.pathExists).not.toBe(saved.pathExists)

      const shimmed = await reader(unpatched).loadConfig()
      const reference = await reader(patched).loadConfig()
      expect(shimmed.app.extConfigType).toBe("json")
      expect(shimmed.app.extConfig).toEqual(CONFIG)
      for (const key of ["appId", "appName", "webDir", "extConfig"])
        expect(shimmed.app[key]).toEqual(reference.app[key])
    } finally {
      fsx.pathExists = saved.pathExists
      fsx.readJSON = saved.readJSON
    }
  })
})
