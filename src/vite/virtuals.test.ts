// @vitest-environment node
import { resolveConfig } from "vite"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ServiceWorkerUpdatePolicy } from "#adaptv/config/app-config.ts"
import { adaptvPwaRegisterPlugin } from "#adaptv/vite/virtuals.ts"

const REGISTER_ID = "virtual:adaptv/pwa-register"

function load(
  swEnabled: boolean,
  updatePolicy?: ServiceWorkerUpdatePolicy,
): string {
  const plugin = adaptvPwaRegisterPlugin(swEnabled, false, updatePolicy)
  const resolveId = plugin.resolveId
  const loadHook = plugin.load
  if (typeof resolveId !== "function" || typeof loadHook !== "function")
    throw new Error("resolveId/load must be plain functions")
  // biome-ignore lint/suspicious/noExplicitAny: calling Vite hooks outside Vite
  const resolved = (resolveId as any).call({}, REGISTER_ID, undefined, {})
  // biome-ignore lint/suspicious/noExplicitAny: calling Vite hooks outside Vite
  return (loadHook as any).call({}, resolved, {}) as string
}

describe("adaptvPwaRegisterPlugin", () => {
  it("serves the real registration when the worker is on", () => {
    const source = load(true)
    expect(source).toContain("navigator.serviceWorker.register")
    expect(source).toContain("updateViaCache")
  })

  it("serves a stub when the worker is off, so the bundler can drop it", () => {
    //`sw.enabled` is false on exactly one build, the native one. The shell
    //already refuses to register there at runtime, but a runtime guard still
    //SHIPS the code it guards — the whole registration path was landing in the
    //`.ipa`/`.apk` to be skipped on its first line. → `docs/design/lifecycle.md §3.2a`
    const source = load(false)
    expect(source).toContain("export function registerSW()")
    expect(source).not.toContain("navigator.serviceWorker.register")
    expect(source).not.toContain("updateViaCache")
    expect(source).not.toContain("controllerchange")
  })

  it("exports registerSW either way — the shell imports it unconditionally", () => {
    //A missing export is a build failure, not a smaller bundle.
    for (const enabled of [true, false])
      expect(load(enabled)).toMatch(/export function registerSW\s*\(/)
  })

  it("bakes `serviceWorkerUpdate` in as a constant, both ways", () => {
    //The policy is a property of the app, not a runtime argument: the shell that
    //calls `registerSW` has never read the app config. `auto` must reach the
    //client as `false` so the launch-apply branch runs. → `docs/design/rendering.md §3.4`
    expect(load(true, "auto")).toContain("const PROMPT = false")
    expect(load(true, "prompt")).toContain("const PROMPT = true")
    //auto is the default, and the default is the silent one
    expect(load(true)).toContain("const PROMPT = false")
  })

  it("never leaks the placeholder into the emitted module", () => {
    //The one failure this whole file exists to prevent. An unsubstituted
    //`__ADAPTV_SW_PROMPT__` is a ReferenceError on the first line of `registerSW`,
    //inside a `try` whose `catch` is dev-gated — so in PRODUCTION the app would
    //register no worker at all, with nothing logged anywhere. Renaming the
    //placeholder without updating the `.replace()` is all it would take.
    for (const policy of ["auto", "prompt"] as const) {
      expect(load(true, policy)).not.toContain("__ADAPTV_SW_PROMPT__")
      expect(load(true, policy)).not.toContain("__ADAPTV_SW_URL__")
    }
  })

  it("claims only its own id", () => {
    const plugin = adaptvPwaRegisterPlugin(true)
    const resolveId = plugin.resolveId
    if (typeof resolveId !== "function") throw new Error("not a function")
    // biome-ignore lint/suspicious/noExplicitAny: calling Vite hooks outside Vite
    expect((resolveId as any).call({}, "react", undefined, {})).toBeNull()
  })
})

describe("adaptvPwaRegisterPlugin — the URL it registers", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * Resolve `base` with Vite itself, run the plugin's hooks the way Vite does,
   * then run the emitted module with `import.meta.env` replaced by the values
   * Vite would inline, and return the URL handed to `register()`.
   */
  async function registeredUrl(base: string): Promise<string> {
    const config = await resolveConfig(
      { base, configFile: false, logLevel: "silent" },
      "build",
    )
    const plugin = adaptvPwaRegisterPlugin(true)
    // biome-ignore lint/suspicious/noExplicitAny: calling Vite hooks outside Vite
    const hooks = plugin as any
    hooks.configResolved?.call({}, config)
    const id = hooks.resolveId.call({}, REGISTER_ID, undefined, {})
    const source = (hooks.load.call({}, id) as string)
      .replaceAll(
        "import.meta.env",
        () => `(${JSON.stringify(config.env)})`,
      )
      .replaceAll("export function", "function")
      .replace("export const", "const")

    const register = vi.fn(async (_url: string, _options: unknown) => ({
      waiting: null,
      addEventListener() {},
    }))
    vi.stubGlobal("navigator", {
      serviceWorker: { register, addEventListener() {}, controller: null },
    })
    new Function(`${source}\nregisterSW()`)()
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce())
    return register.mock.calls[0][0]
  }

  it("registers the worker under a slashless base, where it is served", async () => {
    //The premise, read from Vite rather than restated: `config.base` gains its
    //slash and `BASE_URL` keeps the base as written. `BASE_URL + "sw.js"` was
    //therefore `/appsw.js`, a 404 on every host, so the app silently ran with no
    //worker while the build had emitted one at `/app/sw.js`.
    const config = await resolveConfig(
      { base: "/app", configFile: false, logLevel: "silent" },
      "build",
    )
    expect([config.base, config.env.BASE_URL]).toEqual(["/app/", "/app"])

    expect(await registeredUrl("/app")).toBe("/app/sw.js")
  })

  it("registers the same URL with the slash written, and at the root", async () => {
    expect(await registeredUrl("/app/")).toBe("/app/sw.js")
    expect(await registeredUrl("/")).toBe("/sw.js")
  })

  it("bakes a base carrying a replacement pattern as written", async () => {
    //A string passed to `.replace()` expands `$&` and `$$`, so a `$` in a base
    //once baked the placeholder's own name into the URL.
    expect(await registeredUrl("/a$&b/")).toBe("/a$&b/sw.js")
  })
})
