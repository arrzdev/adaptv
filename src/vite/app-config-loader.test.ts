import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defaultExportError } from "#adaptv/vite/app-config-errors"
import {
  loadAppConfig,
  readAppConfig,
} from "#adaptv/vite/app-config-loader"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "adaptv-config-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** Write `adaptv.config.ts` as a consumer would — minus the parts under test. */
async function writeConfig(body: string): Promise<void> {
  await writeFile(
    path.join(dir, "adaptv.config.ts"),
    `export default {\n${body}\n}\n`,
  )
}

/**
 * What a file whose default export is not a config object is told, tagged as adaptv's. The
 * CLI prints the same sentence without the tag (`bin/lib/load-config.mjs`), and strips the tag
 * when this one reaches it through a build's log (`bin/lib/explain.mjs`).
 */
const NOT_A_CONFIG =
  "[adaptv] adaptv.config.ts must 'export default defineApp({ ... })'"

const usable = `
  name: "Probe",
  description: "d",
  themeColor: { light: "#eeeeec" },
  styles: "./src/styles/main.css",
  router: { routesDirectory: "./routing" },
`

describe("loadAppConfig", () => {
  it("loads a config the build can use", async () => {
    await writeConfig(usable)
    const { config, watchFiles } = await loadAppConfig(dir)
    expect(config.name).toBe("Probe")
    expect(watchFiles).toContain(path.join(dir, "adaptv.config.ts"))
  })

  it("names the file and the key when a value cannot be built", async () => {
    //the exact case that used to reach the root-route module and die there as
    //`TypeError: Cannot read properties of undefined (reading 'replace')`
    await writeConfig(usable.replace(/^\s*styles:.*\n/m, ""))
    await expect(loadAppConfig(dir)).rejects.toThrow(
      "[adaptv] adaptv.config.ts: 'styles' must be a path to the app's stylesheet, got undefined",
    )
  })

  it("lists every problem, one per line", async () => {
    await writeConfig(`
      name: "Probe",
      styles: "./src/styles/main.css",
      router: {},
      themeColor: { light: "white" },
      orientation: "sideways",
    `)
    const message = await loadAppConfig(dir).then(
      () => "",
      (error: Error) => error.message,
    )
    expect(message.split("\n")).toEqual([
      "[adaptv] adaptv.config.ts: 'themeColor.light' must be a hex colour like #1b1b1b, got \"white\"",
      "[adaptv] adaptv.config.ts: 'orientation' must be portrait, landscape or any, got \"sideways\"",
    ])
  })

  it("reads the file without judging it, for the CLI's own checks", async () => {
    //`bin/lib/load-config.mjs` goes through `readAppConfig`: the same bundle,
    //the thunks left inert, and no verdict — the CLI's preflight gives that
    await writeConfig(`name: 42, splashScreen: () => import("./splash")`)
    const { loaded, watchFiles } = await readAppConfig(dir)
    expect((loaded as { name: unknown }).name).toBe(42)
    expect(typeof (loaded as { splashScreen: unknown }).splashScreen).toBe(
      "function",
    )
    expect(watchFiles).toContain(path.join(dir, "adaptv.config.ts"))
  })

  it("watches an imported module at its real path when the cwd is not the app", async () => {
    //the tests run from the repo root, which is exactly the case: an `appRoot`
    //passed to `adaptv()` that is not where the process started
    expect(process.cwd()).not.toBe(dir)
    await writeFile(
      path.join(dir, "theme.ts"),
      `export const light = "#eee"\n`,
    )
    await writeFile(
      path.join(dir, "adaptv.config.ts"),
      `import { light } from "./theme"\nexport default { light }\n`,
    )
    const { watchFiles } = await readAppConfig(dir)
    expect(watchFiles.sort()).toEqual(
      [
        path.join(dir, "adaptv.config.ts"),
        path.join(dir, "theme.ts"),
      ].sort(),
    )
  })

  it("still refuses a file with no default export", async () => {
    await writeFile(
      path.join(dir, "adaptv.config.ts"),
      "export const config = {}\n",
    )
    //quoted with an apostrophe, not a backtick: this reaches a terminal (R43)
    await expect(loadAppConfig(dir)).rejects.toThrow(
      new Error(NOT_A_CONFIG),
    )
  })

  it.each([
    ["an empty array", "export default []\n"],
    ["an array holding a usable config", `export default [{${usable}}]\n`],
  ])(
    "refuses a default export that is %s, before naming any key",
    async (_, source) => {
      //`typeof []` is "object", so an array passed the export guard and was answered by the
      //key checks instead, as "adaptv.config.ts: the config must be an object"
      await writeFile(path.join(dir, "adaptv.config.ts"), source)
      await expect(loadAppConfig(dir)).rejects.toThrow(
        new Error(NOT_A_CONFIG),
      )
    },
  )

  it("refuses with the same sentence as the guard the CLI asks, behind its tag", async () => {
    //compares the words only, so an identical copy here would still pass; the one-copy
    //check is the source walk in `bin/lib/load-config.test.mjs`
    await writeFile(
      path.join(dir, "adaptv.config.ts"),
      "export default 42\n",
    )
    const message = await loadAppConfig(dir).then(
      () => "",
      (error: Error) => error.message,
    )
    expect(message).toBe(`[adaptv] ${defaultExportError(42)}`)
  })
})
