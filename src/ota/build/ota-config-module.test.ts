import { afterEach, describe, expect, it } from "vitest"
import type { AdaptvAppConfig } from "#adaptv/config/app-config"
import {
  assertReachableOtaOrigin,
  DEFAULT_OTA_POLL_MINUTES,
  resolveOtaBuildConfig,
  resolveOtaOrigin,
  resolveOtaPollIntervalMs,
} from "#adaptv/ota/build/ota-config-module"

const BASE: AdaptvAppConfig = {
  name: "ChopChop",
  description: "A focused task list.",
  themeColor: { light: "#eeeeec", dark: "#0a0a0c" },
  backgroundColor: "#ffffff",
  styles: "./src/styles/main.css",
  appId: "com.chopchop.app",
  router: {
    routesDirectory: "./routing",
    routerConfig: "./src/routing/config.ts",
  },
}

afterEach(() => {
  process.env.ADAPTV_OTA_ORIGIN = undefined
  delete process.env.ADAPTV_OTA_ORIGIN
})

describe("resolveOtaOrigin", () => {
  it("uses the app's own origin, trailing slashes and all", () => {
    expect(
      resolveOtaOrigin({
        ...BASE,
        origin: "https://chop.app///",
      }),
    ).toBe("https://chop.app")
  })

  it("is null when the app declares no origin, which is OTA off", () => {
    expect(resolveOtaOrigin(BASE)).toBeNull()
  })

  it("lets ADAPTV_OTA_ORIGIN win, so a bench never edits the baked origin", () => {
    process.env.ADAPTV_OTA_ORIGIN = "http://localhost:41790"
    expect(resolveOtaOrigin({ ...BASE, origin: "https://chop.app" })).toBe(
      "http://localhost:41790",
    )
  })
})

describe("an origin the installed app can actually read", () => {
  it("accepts https", () => {
    expect(() =>
      assertReachableOtaOrigin("https://chop.app"),
    ).not.toThrow()
  })

  it("refuses plain http, because both platforms block it before the network", () => {
    expect(() =>
      assertReachableOtaOrigin("http://updates.chop.app"),
    ).toThrow(/must be https/)
  })

  it("says what the failure would look like, since it looks like nothing", () => {
    expect(() =>
      assertReachableOtaOrigin("http://updates.chop.app"),
    ).toThrow(/silently stay on its store version/)
  })

  it("allows a local address, which is a bench and not a channel", () => {
    for (const origin of [
      "http://localhost:41790",
      "http://127.0.0.1:41790",
      "http://10.0.2.2:41790",
    ]) {
      expect(() => assertReachableOtaOrigin(origin)).not.toThrow()
    }
  })

  it("refuses a host that merely starts like a local one", () => {
    expect(() =>
      assertReachableOtaOrigin("http://localhost.chop.app"),
    ).toThrow(/must be https/)
  })

  it("refuses something that is not an origin at all", () => {
    expect(() => assertReachableOtaOrigin("chop.app")).toThrow(/valid URL/)
  })
})

describe("resolveOtaBuildConfig", () => {
  it("is null with no origin, so the bundle carries no manifest URL", () => {
    expect(resolveOtaBuildConfig("/nowhere", BASE)).toBeNull()
  })

  it("is null with no appId, because there is no native build to update", () => {
    expect(
      resolveOtaBuildConfig("/nowhere", {
        ...BASE,
        appId: undefined,
        origin: "https://chop.app",
      }),
    ).toBeNull()
  })

  it("fails the build on an unreachable origin, before reading anything else", () => {
    //`/nowhere` is not a project: reaching the fingerprint step would fail for a
    //different reason, so this also pins the guard as the FIRST thing that runs.
    expect(() =>
      resolveOtaBuildConfig("/nowhere", {
        ...BASE,
        origin: "http://updates.chop.app",
      }),
    ).toThrow(/must be https/)
  })

  it("defaults to installing a bundle built for a different native layer", async () => {
    //The opinionated half: an app that configures nothing still gets every fix
    //that ships alongside a native change, rather than freezing until the store
    //catches up. Resolved HERE so the shipped bundle carries a literal answer
    //and no runtime has to reproduce the default.
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs")
    const { tmpdir } = await import("node:os")
    const { join } = await import("node:path")
    const root = mkdtempSync(join(tmpdir(), "adaptv-ota-"))
    try {
      writeFileSync(join(root, "package.json"), "{}")

      const config = { ...BASE, origin: "https://chop.app" }
      expect(resolveOtaBuildConfig(root, config)?.nativeSkew).toBe(
        "install",
      )
      expect(
        resolveOtaBuildConfig(root, {
          ...config,
          otaOnNativeSkew: "refuse",
        })?.nativeSkew,
      ).toBe("refuse")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("resolveOtaPollIntervalMs", () => {
  it("gives an app that configures nothing an hourly look", () => {
    expect(resolveOtaPollIntervalMs(BASE)).toBe(
      DEFAULT_OTA_POLL_MINUTES * 60_000,
    )
  })

  it("takes 0 as the way to turn the poll off", () => {
    //Off, not "unset" — launch and resume still check. There is no configuration
    //that leaves an app never looking for an update.
    expect(resolveOtaPollIntervalMs({ ...BASE, otaPollMinutes: 0 })).toBe(
      0,
    )
  })

  it("converts minutes to milliseconds once, at build time", () => {
    expect(resolveOtaPollIntervalMs({ ...BASE, otaPollMinutes: 15 })).toBe(
      900_000,
    )
  })

  it("refuses a number small enough to be seconds", () => {
    //🔴 The mistake this exists for. `otaPollMinutes: 30` meaning half a minute
    //and `otaPollMinutes: 30` meaning half an hour look identical in a config
    //file and differ by sixty times the traffic — and the difference only ever
    //shows up on someone's CDN bill, never in testing. Refused rather than
    //clamped, because a clamp is a silent reinterpretation of what was written.
    expect(() =>
      resolveOtaPollIntervalMs({ ...BASE, otaPollMinutes: 0.5 }),
    ).toThrow(/MINUTES, not seconds/)
    expect(() =>
      resolveOtaPollIntervalMs({ ...BASE, otaPollMinutes: 2 }),
    ).toThrow(/below the 5-minute minimum/)
  })

  it("refuses a value that is not a number of minutes at all", () => {
    expect(() =>
      resolveOtaPollIntervalMs({ ...BASE, otaPollMinutes: -60 }),
    ).toThrow(/whole number of minutes/)
    expect(() =>
      resolveOtaPollIntervalMs({ ...BASE, otaPollMinutes: Number.NaN }),
    ).toThrow(/whole number of minutes/)
  })
})
