import { afterEach, describe, expect, it } from "vitest"
import {
  DEV_SW_ENV,
  devServiceWorkerEnabled,
} from "#adaptv/vite/sw-dev.ts"
import { adaptvPwaRegisterPlugin } from "#adaptv/vite/virtuals.ts"

const original = process.env[DEV_SW_ENV]
afterEach(() => {
  if (original === undefined) delete process.env[DEV_SW_ENV]
  else process.env[DEV_SW_ENV] = original
})

/** Load the register virtual module the way Vite would. */
function loadRegister(
  swEnabled: boolean,
  devSw: boolean,
  policy: "auto" | "prompt" = "auto",
): string {
  const plugin = adaptvPwaRegisterPlugin(swEnabled, devSw, policy)
  const load = plugin.load as (id: string) => string | null
  const id = "\0virtual:adaptv/pwa-register"
  const source = load.call({} as never, id)
  if (!source) throw new Error("virtual module did not load")
  return source
}

describe("devServiceWorkerEnabled", () => {
  it("is OFF unless the env var is deliberately set", () => {
    delete process.env[DEV_SW_ENV]
    expect(devServiceWorkerEnabled()).toBe(false)
  })

  it("treats an empty value and '0' as off, not as 'set'", () => {
    //`ADAPTV_DEV_SW=` in a .env file is how someone turns it OFF again; reading
    //it as truthy would leave dev serving a worker they thought they disabled.
    process.env[DEV_SW_ENV] = ""
    expect(devServiceWorkerEnabled()).toBe(false)
    process.env[DEV_SW_ENV] = "0"
    expect(devServiceWorkerEnabled()).toBe(false)
  })

  it("is on for any other value", () => {
    process.env[DEV_SW_ENV] = "1"
    expect(devServiceWorkerEnabled()).toBe(true)
  })
})

describe("the register module carries the dev decision", () => {
  it("ships DEV_SW_ENABLED=false by default, so dev stays SW-free", () => {
    //The shell branches on this to decide whether dev DESTROYS workers or
    //registers one. Defaulting it wrong means every dev session gets a worker.
    expect(loadRegister(true, false)).toContain(
      "export const DEV_SW_ENABLED = false",
    )
  })

  it("ships DEV_SW_ENABLED=true when the hatch is armed", () => {
    expect(loadRegister(true, true)).toContain(
      "export const DEV_SW_ENABLED = true",
    )
  })

  it("still exports registerSW on the native stub, armed or not", () => {
    //the shell imports both bindings unconditionally — a missing export is a
    //build error in the consumer's app, not in adaptv
    for (const dev of [false, true]) {
      const source = loadRegister(false, dev)
      expect(source).toContain("export function registerSW()")
      expect(source).toContain("export const DEV_SW_ENABLED")
    }
  })
})

describe("serviceWorkerUpdate is baked into the registration", () => {
  it("bakes the policy as a literal, never leaving the placeholder in", () => {
    //`__ADAPTV_SW_PROMPT__` surviving into the browser is a ReferenceError on the
    //first line of registration — no worker at all, on every page load.
    for (const policy of ["auto", "prompt"] as const) {
      const source = loadRegister(true, false, policy)
      expect(source).not.toContain("__ADAPTV_SW_PROMPT__")
      expect(source).toContain(`const PROMPT = ${policy === "prompt"}`)
    }
  })

  it("defaults to auto — the invisible cold-launch update", () => {
    expect(loadRegister(true, false)).toContain("const PROMPT = false")
  })

  it("only the prompt build hands the app a way to hold the update", () => {
    //Under `auto` there must be no callback path at all: an app calling
    //`useServiceWorkerUpdate()` should see `false` forever, not a banner it
    //cannot dismiss because the worker already activated underneath it.
    expect(loadRegister(true, false, "prompt")).toContain("onWaiting?.(")
    expect(loadRegister(true, false, "prompt")).toContain("updatefound")
  })
})
