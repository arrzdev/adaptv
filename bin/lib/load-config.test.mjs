// @vitest-environment node
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadConfig } from "./load-config.mjs"
import { ADAPTV_ROOT, loadAdaptvModule } from "./load-ts.mjs"
import { namesPlumbing } from "./opacity.mjs"

/**
 * The one definition of a usable config, as every command reads it: `preflight` for a run,
 * `doctor` for its report, `icons` for where the set goes.
 *
 * `cli-process.test.mjs` does run `doctor` in an empty folder, but as a child process, and
 * `doctor` swallows the throw: nothing there can see which sentence a dev would get, and the
 * other two outcomes never run at all. So these call it in-process, against a throwaway app
 * root per case, and pin the exact sentence. A config error is a plain one-liner that names
 * the fix (R7), so the sentence IS the behaviour.
 */

let dir = null
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

/** A throwaway app root, with `files` written into it by name. */
function appRoot(files = {}) {
  dir = mkdtempSync(path.join(tmpdir(), "adaptv-load-config-"))
  for (const [name, source] of Object.entries(files))
    writeFileSync(path.join(dir, name), source)
  return dir
}

/**
 * The missing-file sentence: the fact, then the fix, on one line, exactly as
 * `docs/design/cli-visual.md` quotes it. "here" is the folder the dev ran the command in, which
 * is the only app root the CLI has; the folder itself is never printed (R9).
 */
const NO_CONFIG = "no adaptv.config.ts here. Run from an app root."

/** What a file whose default export is not a config object is told, by the CLI and the build. */
const NOT_A_CONFIG =
  "adaptv.config.ts must 'export default defineApp({ ... })'"

/**
 * Whether a source file writes the default-export sentence in code, as opposed to quoting it
 * in a comment. House comments quote printed output all the time, and a quote is not a copy
 * that can drift: only a line that is not a comment line counts.
 */
const holdsSentence = (source) =>
  source
    .split("\n")
    .some(
      (line) =>
        !/^\s*(\/\/|\/\*|\*)/.test(line) &&
        line.includes("export default defineApp({ ... })"),
    )

/** The message `loadConfig` rejects with, or `""` when it resolves. */
const refusal = (root) =>
  loadConfig(root).then(
    () => "",
    (error) => error.message,
  )

describe("loadConfig", () => {
  it("refuses a folder with no adaptv.config.ts, naming the fix", async () => {
    //The CLI's own sentence, not the loader's `[adaptv] … not found at …`: the file is
    //checked for before anything is bundled, so a dev in the wrong folder is told what to do
    //about it. The whole sentence is pinned, so no path can come back into it (R9): it used to
    //print the app root in full, which is the dev's home folder and everything under it.
    const message = await refusal(appRoot())
    expect(message).toBe(NO_CONFIG)
    expect(namesPlumbing(message)).toBe(false)
  })

  it("does not take a config under another name for adaptv.config.ts", async () => {
    //The file is found by its exact name. An `adaptv.config.js` next to it is not the config,
    //and reading it would answer a question the dev did not ask.
    const root = appRoot({
      "adaptv.config.js": `export default { appId: "com.example.app" }\n`,
    })
    expect(await refusal(root)).toBe(NO_CONFIG)
  })

  it.each([
    ["no 'appId' key", `export default { name: "Probe" }\n`],
    ["an empty 'appId'", `export default { appId: "", name: "Probe" }\n`],
  ])("refuses a config with %s", async (_, source) => {
    //The build runs without one (a web app has none); no command here can.
    const message = await refusal(appRoot({ "adaptv.config.ts": source }))
    expect(message).toBe("missing 'appId' in adaptv.config.ts")
    expect(namesPlumbing(message)).toBe(false)
  })

  it.each([
    [
      "no default export",
      `export const config = { appId: "com.example.app" }\n`,
    ],
    [
      "a default export that is a string",
      `export default "com.example.app"\n`,
    ],
    ["a default export that is a number", "export default 42\n"],
    ["a default export of null", "export default null\n"],
    ["a default export that is an empty array", "export default []\n"],
    [
      "a default export that is an array holding the config",
      `export default [{ appId: "com.example.app", name: "Probe" }]\n`,
    ],
  ])(
    "refuses a config with %s, naming the export rather than 'appId'",
    async (_, source) => {
      //The first case is the one that mattered: the file plainly holds an `appId`, so being told
      //it is missing reads as a bug in adaptv and points at the one line that is right. An array
      //is an object to `typeof`, and used to fall through to that same wrong sentence even when
      //its one entry held an `appId`. The sentence is the build's own for the same file, quoted
      //for a terminal (R43).
      const message = await refusal(
        appRoot({ "adaptv.config.ts": source }),
      )
      expect(message).toBe(NOT_A_CONFIG)
      expect(namesPlumbing(message)).toBe(false)
    },
  )

  it("refuses a default export with the same sentence as the build's guard", async () => {
    //Both faces give one answer about the same file (R26: two implementations of one idea
    //drift). This compares the words only, so an identical copy in the CLI would still pass
    //it; the walk below is what holds the sentence to one copy.
    const { defaultExportError } = await loadAdaptvModule(
      "vite/app-config-errors.ts",
    )
    expect(defaultExportError([])).toBe(NOT_A_CONFIG)
    expect(defaultExportError({})).toBeNull()
    for (const source of ["export default []\n", "export const x = 1\n"]) {
      const message = await refusal(
        appRoot({ "adaptv.config.ts": source }),
      )
      expect(message).toBe(defaultExportError(undefined))
    }
  })

  it("counts a string that holds the sentence, never a comment that quotes it", () => {
    const quoted =
      "adaptv.config.ts must 'export default defineApp({ ... })'"
    expect(holdsSentence(`const sentence =\n  "${quoted}"\n`)).toBe(true)
    expect(
      holdsSentence(`throw new Error(\`[adaptv] ${quoted}\`)\n`),
    ).toBe(true)
    expect(
      holdsSentence(`  //prints: ${quoted}\n  const notAConfig = 1\n`),
    ).toBe(false)
    expect(holdsSentence(`/**\n * Prints ${quoted}\n */\n`)).toBe(false)
  })

  it("writes that sentence once, in the rule both faces ask", () => {
    //Two copies that agree today are how the CLI came to say "missing 'appId'" for a file the
    //build refused, and how the build kept a backtick after the CLI's copy lost it (R43). That
    //is R26's fault, two implementations of one idea drifting, and a behaviour test cannot see
    //a second copy that still matches, so this reads the source.
    const holders = []
    for (const dir of ["bin", "src"]) {
      const files = readdirSync(path.join(ADAPTV_ROOT, dir), {
        recursive: true,
      })
      for (const file of files) {
        const rel = path.join(dir, String(file))
        if (!/\.(mjs|ts|tsx)$/.test(rel) || /\.test\./.test(rel)) continue
        if (
          holdsSentence(readFileSync(path.join(ADAPTV_ROOT, rel), "utf8"))
        )
          holders.push(rel)
      }
    }
    expect(holders).toEqual(["src/vite/app-config-errors.ts"])
  })

  it("returns the default export of a usable config, as data", async () => {
    //The object itself, not a copy of the keys it recognises: preflight judges every value,
    //so nothing may be dropped on the way. The component thunk points at a file that does not
    //exist, and still comes back as a function: the read leaves it inert, never resolved.
    const root = appRoot({
      "adaptv.config.ts": [
        "export default {",
        `  appId: "com.example.app",`,
        `  name: "Probe",`,
        `  themeColor: { light: "#ffffff" },`,
        `  splashScreen: () => import("./no-such-splash"),`,
        "}",
        "",
      ].join("\n"),
    })
    const config = await loadConfig(root)
    expect(config).toMatchObject({
      appId: "com.example.app",
      name: "Probe",
      themeColor: { light: "#ffffff" },
    })
    expect(Object.keys(config)).toEqual([
      "appId",
      "name",
      "themeColor",
      "splashScreen",
    ])
    expect(typeof config.splashScreen).toBe("function")
  })

  it("reads the file again on every call, so an edit is seen", async () => {
    //The `b` key rebuilds a live session through preflight, which calls this again on the
    //same app root (R39): a result kept from the first read would rebuild from a config the
    //file on disk no longer holds.
    const root = appRoot({
      "adaptv.config.ts": `export default { appId: "com.example.first" }\n`,
    })
    expect((await loadConfig(root)).appId).toBe("com.example.first")
    writeFileSync(
      path.join(root, "adaptv.config.ts"),
      `export default { appId: "com.example.second" }\n`,
    )
    expect((await loadConfig(root)).appId).toBe("com.example.second")
  })
})
