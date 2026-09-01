import { describe, expect, it } from "vitest"
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
    for (const policy of ["auto", "prompt"] as const)
      expect(load(true, policy)).not.toContain("__ADAPTV_SW_PROMPT__")
  })

  it("claims only its own id", () => {
    const plugin = adaptvPwaRegisterPlugin(true)
    const resolveId = plugin.resolveId
    if (typeof resolveId !== "function") throw new Error("not a function")
    // biome-ignore lint/suspicious/noExplicitAny: calling Vite hooks outside Vite
    expect((resolveId as any).call({}, "react", undefined, {})).toBeNull()
  })
})
