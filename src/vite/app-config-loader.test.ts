import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadAppConfig } from "#adaptv/vite/app-config-loader"

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

  it("still refuses a file with no default export", async () => {
    await writeFile(
      path.join(dir, "adaptv.config.ts"),
      "export const config = {}\n",
    )
    await expect(loadAppConfig(dir)).rejects.toThrow(
      "must `export default defineApp({ ... })`",
    )
  })
})
