import { describe, expect, it } from "vitest"
import {
  classListChanged,
  configIsStale,
  mergeClassList,
  podsNeedInstall,
} from "./native-state.mjs"

// Each block below is a bug that shipped once. The comment on each `it` is the symptom the
// user saw, so a future change that "simplifies" one of these has to argue with the symptom.

describe("configIsStale — is the installed app the one this command means?", () => {
  const DEV = {
    appId: "dev.arrz.projectzero.dev",
    appName: "ChopChop (dev)",
    server: { url: "http://localhost:41710", cleartext: true },
  }
  const RELEASE = { appId: "dev.arrz.projectzero", appName: "ChopChop" }

  it("catches a dev shell when a static build is intended (the app opened on the 'dev server isn't running' screen)", () => {
    expect(configIsStale(DEV, RELEASE)).toBe(true)
  })

  it("catches the reverse: a static install when dev wants live reload", () => {
    expect(configIsStale(RELEASE, DEV)).toBe(true)
  })

  it("is false when they agree, so the caches still work", () => {
    expect(configIsStale(RELEASE, { ...RELEASE })).toBe(false)
    expect(configIsStale(DEV, { ...DEV })).toBe(false)
  })

  it("ignores the keys `cap sync` and adaptv add — comparing whole objects would re-sync every run", () => {
    expect(
      configIsStale(
        { ...RELEASE, packageClassList: ["AppPlugin"], plugins: { A: 1 } },
        RELEASE,
      ),
    ).toBe(false)
  })

  it("treats a different dev URL as fine but a MISSING server as stale (presence is what changes behaviour)", () => {
    expect(
      configIsStale(DEV, {
        ...DEV,
        server: { url: "http://192.168.1.18:41710" },
      }),
    ).toBe(false)
    expect(configIsStale(DEV, { ...DEV, server: undefined })).toBe(true)
  })

  it("never vouches for an install it cannot read", () => {
    expect(configIsStale(null, RELEASE)).toBe(true)
    expect(configIsStale(undefined, RELEASE)).toBe(true)
  })
})

describe("podsNeedInstall — the out-of-sync sandbox dead end", () => {
  it("installs when the Podfile changed", () => {
    expect(
      podsNeedInstall({
        podfileChanged: true,
        hasPodfileLock: true,
        hasManifestLock: true,
      }),
    ).toBe(true)
  })

  it("ALSO installs when the Podfile is fine but the lockfiles are gone — a Ctrl-C'd CocoaPods left `Pods/` half-written, and every later build failed with 'The sandbox is not in sync with the Podfile.lock'", () => {
    expect(
      podsNeedInstall({
        podfileChanged: false,
        hasPodfileLock: false,
        hasManifestLock: false,
      }),
    ).toBe(true)
    // one lockfile alone is still out of sync
    expect(
      podsNeedInstall({
        podfileChanged: false,
        hasPodfileLock: true,
        hasManifestLock: false,
      }),
    ).toBe(true)
  })

  it("skips the ~2s install when nothing changed and the sandbox is intact", () => {
    expect(
      podsNeedInstall({
        podfileChanged: false,
        hasPodfileLock: true,
        hasManifestLock: true,
      }),
    ).toBe(false)
  })
})

describe("mergeClassList — plugins that compile but never register", () => {
  const CAP_FOUND = ["DevicePlugin"] //what `cap sync` discovers from the APP's deps
  const ADAPTV = [
    "SplashScreenPlugin",
    "KeyboardPlugin",
    "StatusBarPlugin",
  ]

  it("adds adaptv's own plugins, which Capacitor cannot discover — without them SplashScreen.hide() threw and the splash hung forever", () => {
    expect(mergeClassList(CAP_FOUND, ADAPTV)).toEqual([
      "DevicePlugin",
      "SplashScreenPlugin",
      "KeyboardPlugin",
      "StatusBarPlugin",
    ])
  })

  it("is idempotent — `cap` rewrites this list every sync, so a merge that duplicated would grow without bound", () => {
    const once = mergeClassList(CAP_FOUND, ADAPTV)
    expect(mergeClassList(once, ADAPTV)).toEqual(once)
    expect(classListChanged(once, mergeClassList(once, ADAPTV))).toBe(
      false,
    )
  })

  it("reports a change only when something was actually added (skips a pointless write)", () => {
    expect(
      classListChanged(CAP_FOUND, mergeClassList(CAP_FOUND, ADAPTV)),
    ).toBe(true)
  })

  it("survives a project that has no list yet", () => {
    expect(mergeClassList(undefined, ADAPTV)).toEqual(ADAPTV)
  })
})
