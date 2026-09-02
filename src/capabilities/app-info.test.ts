import { App } from "@capacitor/app"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getAppInfo,
  getAppInfoCaveat,
  resetAppInfo,
} from "#adaptv/capabilities/app-info"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isNativePlatform } from "#adaptv/utils/platform"

vi.mock("@capacitor/app", () => ({
  App: {
    getInfo: vi.fn(async () => ({
      name: "ChopChop",
      id: "dev.arrz.projectzero",
      version: "1.4.0",
      build: "42",
    })),
  },
}))
vi.mock("#adaptv/utils/platform", () => ({
  isNativePlatform: vi.fn(() => false),
}))
vi.mock("#adaptv/utils/native-plugins", () => ({
  hasNativePlugin: vi.fn(() => true),
}))

const NULLS = { name: null, id: null, version: null, build: null }

/** A document that serves the manifest adaptv generates, or the failure asked for. */
function web(
  manifest: unknown,
  { href = "/manifest.json", ok = true } = {},
) {
  vi.stubGlobal("document", {
    querySelector: () =>
      href === null ? null : { getAttribute: () => href },
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      json: async () => manifest,
    })),
  )
}

function native(plugin = true) {
  vi.mocked(isNativePlatform).mockReturnValue(true)
  vi.mocked(hasNativePlugin).mockReturnValue(plugin)
}

beforeEach(() => {
  resetAppInfo()
  vi.mocked(App.getInfo).mockResolvedValue({
    name: "ChopChop",
    id: "dev.arrz.projectzero",
    version: "1.4.0",
    build: "42",
  } as never)
  vi.mocked(isNativePlatform).mockReturnValue(false)
  vi.mocked(hasNativePlugin).mockReturnValue(true)
  web({ name: "ChopChop", short_name: "Chop", id: "/" })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("getAppInfo — native", () => {
  it("reports the binary's name, id, version and build", async () => {
    native()
    expect(await getAppInfo()).toEqual({
      name: "ChopChop",
      id: "dev.arrz.projectzero",
      version: "1.4.0",
      build: "42",
    })
    expect(fetch).not.toHaveBeenCalled()
    expect(getAppInfoCaveat()).toBeNull()
  })

  it("a refused plugin call falls to the manifest, never to a throw", async () => {
    native()
    vi.mocked(App.getInfo).mockRejectedValue(new Error("nope") as never)
    await expect(getAppInfo()).resolves.toEqual({
      name: "ChopChop",
      id: "/",
      version: null,
      build: null,
    })
  })

  it("a binary built before the plugin says so, and asks the plugin nothing", async () => {
    native(false)
    //the two fields that need the binary are the two that go null; the name is
    //still the one adaptv generated the manifest from
    await expect(getAppInfo()).resolves.toEqual({
      name: "ChopChop",
      id: "/",
      version: null,
      build: null,
    })
    expect(App.getInfo).not.toHaveBeenCalled()
    expect(getAppInfoCaveat()).toContain("built before")
  })

  it("a refused plugin with no manifest either is a record of nulls", async () => {
    native()
    vi.mocked(App.getInfo).mockRejectedValue(new Error("nope") as never)
    vi.stubGlobal("document", { querySelector: () => null })
    await expect(getAppInfo()).resolves.toEqual(NULLS)
  })

  it("reads once and keeps it: a new binary is a new process", async () => {
    native()
    await getAppInfo()
    await getAppInfo()
    expect(App.getInfo).toHaveBeenCalledTimes(1)
  })
})

describe("getAppInfo — the web", () => {
  it("takes the name and the identity from the manifest and refuses to invent a version", async () => {
    expect(await getAppInfo()).toEqual({
      name: "ChopChop",
      id: "/",
      version: null,
      build: null,
    })
    expect(App.getInfo).not.toHaveBeenCalled()
    expect(getAppInfoCaveat()).toContain("no installed version")
  })

  it("falls back to the short name, which is what a home screen shows", async () => {
    web({ short_name: "Chop" })
    expect((await getAppInfo()).name).toBe("Chop")
  })

  it("does not invent a name for a manifest that has none", async () => {
    web({ id: "/" })
    expect(await getAppInfo()).toEqual({ ...NULLS, id: "/" })
  })

  it("an empty string is not an answer", async () => {
    web({ name: "", id: "" })
    expect(await getAppInfo()).toEqual(NULLS)
  })

  it("a manifest that 404s, one that is not JSON, and a page with no manifest link are all nulls", async () => {
    web({ name: "ChopChop" }, { ok: false })
    expect(await getAppInfo()).toEqual(NULLS)

    resetAppInfo()
    vi.stubGlobal("document", {
      querySelector: () => ({ getAttribute: () => "/manifest.json" }),
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => {
          throw new Error("not json")
        },
      })),
    )
    expect(await getAppInfo()).toEqual(NULLS)

    resetAppInfo()
    vi.stubGlobal("document", { querySelector: () => null })
    expect(await getAppInfo()).toEqual(NULLS)
  })

  it("the server renders nothing and asks for nothing", async () => {
    vi.stubGlobal("document", undefined)
    expect(await getAppInfo()).toEqual(NULLS)
  })
})
