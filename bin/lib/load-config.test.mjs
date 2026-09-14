// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { loadConfig } from "./load-config.mjs"
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
 * The missing-file sentence, with whatever names the folder left open: the fact, then the fix,
 * on one line (`docs/design/cli-visual.md` quotes it as `no adaptv.config.ts here. Run from an
 * app root.`).
 */
const NO_CONFIG = /^no adaptv\.config\.ts .+\. Run from an app root\.$/

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
    //about it. The folder in the middle is deliberately NOT pinned: today it prints the
    //absolute path, which R9 forbids, and a test must not hold that in place.
    const message = await refusal(appRoot())
    expect(message).toMatch(NO_CONFIG)
    expect(namesPlumbing(message)).toBe(false)
  })

  it("does not take a config under another name for adaptv.config.ts", async () => {
    //The file is found by its exact name. An `adaptv.config.js` next to it is not the config,
    //and reading it would answer a question the dev did not ask.
    const root = appRoot({
      "adaptv.config.js": `export default { appId: "com.example.app" }\n`,
    })
    expect(await refusal(root)).toMatch(NO_CONFIG)
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
