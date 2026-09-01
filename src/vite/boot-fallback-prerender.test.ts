import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { BOOT_CODES, BOOT_RETRY_ATTR } from "#adaptv/shell/boot-fallback"
import { prerenderBootFallback } from "#adaptv/vite/boot-fallback-prerender"

/*
 * A real esbuild + `react-dom/server` round trip, deliberately. The value of this
 * step is entirely in whether a React component with Tailwind on it actually
 * comes out the other side as markup — a mocked bundler would assert nothing.
 * → docs/design/rendering.md §3.1.3
 *
 * The bundle is built ONCE for the file. Each call bundles React and
 * `react-dom/server` from scratch, which is ~everything this step costs; running
 * it per assertion put enough load on the suite to start surfacing a latent flake
 * elsewhere in it.
 */

let cached: Promise<Record<string, string>> | undefined
const defaultScreen = () => {
  cached ??= prerenderBootFallback({
    appRoot: process.cwd(),
    specifier: null,
  })
  return cached
}

describe("prerenderBootFallback — React in, static HTML out", () => {
  it("renders adaptv's default screen to markup", async () => {
    const html = (await defaultScreen())[BOOT_CODES.load] as string
    expect(html).toContain('data-adaptv="boot-error"')
    expect(html).toContain("Something went wrong")
  }, 60_000)

  it("keeps the Tailwind classes, which the app stylesheet already carries", () => {
    //`styles/index.css` declares `@source "../**\/*.{ts,tsx}"`, so adaptv's own
    //component classes are generated into the app's CSS — a different file from
    //the JS that broke. That is why this path needs no CSS of its own.
    return defaultScreen().then((byCode) => {
      const html = byCode[BOOT_CODES.load] as string
      expect(html).toContain("flex")
      expect(html).toContain("text-gray-950")
    })
  }, 60_000)

  it("stamps the retry hook the watchdog delegates off", async () => {
    //without this the only control on the screen is dead markup: the live Button
    //commits through a gesture engine that is not running in a failed boot
    const html = (await defaultScreen())[BOOT_CODES.load] as string
    expect(html).toContain(BOOT_RETRY_ATTR)
  }, 60_000)

  it("renders one variant per boot code, each given the code as a PROP", async () => {
    //the code has to be a prop — that is the only shape an app can branch on in
    //JSX — and static markup cannot be handed a prop when it is revealed. So the
    //component is rendered once per code and the watchdog picks the copy.
    const byCode = await defaultScreen()
    expect(Object.keys(byCode).sort()).toEqual(
      Object.values(BOOT_CODES).sort(),
    )
  }, 60_000)

  it("comes back identical for every code when the component ignores it", async () => {
    //adaptv's default does not render the code, so all four are the same string
    //and `getBootFallbackMarkup` collapses them to a single copy
    const byCode = await defaultScreen()
    expect(new Set(Object.values(byCode)).size).toBe(1)
  }, 60_000)

  it("never bakes a boot code into adaptv's own screen", async () => {
    const byCode = await defaultScreen()
    expect(byCode[BOOT_CODES.load] as string).not.toContain(
      BOOT_CODES.load,
    )
  }, 60_000)

  it("carries no event handlers at all — the fact the whole design turns on", async () => {
    //`reset` is `undefined` here and `onClick` is never serialized, because a
    //build-time render has no handlers to serialize. This is why the watchdog has
    //to wire the click itself, and why a dev writing `onClick={reset}` is still
    //writing the right thing: live it resets, here the watchdog reloads instead.
    const html = (await defaultScreen())[BOOT_CODES.load] as string
    expect(html).toContain("<button")
    expect(html.toLowerCase()).not.toContain("onclick")
  }, 60_000)

  it("renders the production variant, so no stack reaches the markup", async () => {
    //a build-time render is a production render. The dev-only trace panel must
    //not be baked into a shipped document.
    const html = (await defaultScreen())[BOOT_CODES.load] as string
    expect(html).not.toContain("data-adaptv-error-trace")
  }, 60_000)

  it("routes adaptv's OWN React imports through the app's copy", async () => {
    //THE bug the eight tests above cannot see: they all pass adaptv's own root as
    //`appRoot`, where there is one React to find, so two-copies is impossible. In
    //a real app it is the default — the entry resolves React beside the app, while
    //adaptv's screen resolves it beside adaptv, and pnpm gives those two different
    //stores even at the identical version. A second instance means the hook
    //dispatcher is null: `Cannot read properties of null (reading 'useRef')`.
    //
    //The discriminating import is the component's, not the entry's: the entry
    //already resolves from `appRoot` by construction. `boot-error.tsx` is JSX, so
    //it pulls `react/jsx-runtime` — from adaptv unless something redirects it. So
    //give the app a React whose main entry is real and whose `jsx-runtime` is a
    //booby trap, and require the trap to go off.
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adaptv-boot-"))
    const modules = path.join(appRoot, "node_modules")
    const probe = path.join(modules, "react")
    const require_ = createRequire(import.meta.url)
    fs.mkdirSync(probe, { recursive: true })
    fs.writeFileSync(
      path.join(probe, "package.json"),
      JSON.stringify({
        name: "react",
        version: "0.0.0",
        main: "index.js",
      }),
    )
    fs.writeFileSync(
      path.join(probe, "index.js"),
      `module.exports = require(${JSON.stringify(require_.resolve("react"))})\n`,
    )
    fs.writeFileSync(
      path.join(probe, "jsx-runtime.js"),
      'throw new Error("APP_ROOTED_JSX")\n',
    )
    //the renderer itself is not under test, so let it be the real one
    fs.symlinkSync(
      path.dirname(require_.resolve("react-dom/package.json")),
      path.join(modules, "react-dom"),
    )

    try {
      await expect(
        prerenderBootFallback({ appRoot, specifier: null }),
      ).rejects.toThrow("APP_ROOTED_JSX")
    } finally {
      fs.rmSync(appRoot, { recursive: true, force: true })
    }
  }, 60_000)

  it("throws when the component cannot be resolved", async () => {
    //the caller downgrades this to a loud warning — an app still ships without
    //its boot fallback — but it must never fail silently here
    await expect(
      prerenderBootFallback({
        appRoot: process.cwd(),
        specifier: "@/nope/not-a-real-module",
      }),
    ).rejects.toThrow()
  }, 60_000)
})
