import { describe, expect, it } from "vitest"
import { formatDiagnostics, runDoctor } from "#adaptv/native/doctor"

describe("runDoctor — WKAppBoundDomains (B22)", () => {
  //The highest-severity silent failure in the Capacitor surface: the bridge is
  //never injected, getPlatform() returns "web", and EVERY plugin falls back to
  //its web implementation. No error, no crash.
  it("errors when the plist key is set without the Capacitor opt-in", () => {
    const [d] = runDoctor({
      iosInfoPlist: "<key>WKAppBoundDomains</key><array/>",
      capacitorConfig: "{}",
    })
    expect(d?.severity).toBe("error")
    expect(d?.title).toContain("WKAppBoundDomains")
  })

  it("stays quiet when the app has opted in properly", () => {
    expect(
      runDoctor({
        iosInfoPlist: "<key>WKAppBoundDomains</key><array/>",
        capacitorConfig:
          '{"ios":{"limitsNavigationsToAppBoundDomains":true}}',
      }),
    ).toHaveLength(0)
  })

  it("stays quiet when the key is absent — the normal case", () => {
    expect(
      runDoctor({ iosInfoPlist: "<key>CFBundleName</key>" }),
    ).toHaveLength(0)
  })

  it("explains that plugins fall back SILENTLY, not that config is invalid", () => {
    //someone reading this needs to recognise the symptom they are seeing
    const [d] = runDoctor({
      iosInfoPlist: "WKAppBoundDomains",
      capacitorConfig: "{}",
    })
    expect(d?.detail).toContain("silently")
    expect(d?.detail).toContain("getPlatform")
  })
})

describe("runDoctor — Android target SDK (§6.0)", () => {
  it("warns below 36", () => {
    const [d] = runDoctor({ androidBuildGradle: "targetSdkVersion 34" })
    expect(d?.severity).toBe("warning")
    expect(d?.title).toContain("36")
  })

  it("is quiet at 36 and above", () => {
    expect(
      runDoctor({ androidBuildGradle: "targetSdk = 36" }),
    ).toHaveLength(0)
  })

  it("names the no-op behaviour, which is the part that bites", () => {
    //the app keeps compiling and silently stops tinting
    const [d] = runDoctor({ androidBuildGradle: "targetSdk = 35" })
    expect(d?.detail).toContain("NO-OPS")
  })

  it("says nothing when there is no android project", () => {
    expect(runDoctor({})).toHaveLength(0)
  })
})

describe("runDoctor — privacy manifest (§5.0.1)", () => {
  it("errors when a plugin needs one and it is absent", () => {
    const [d] = runDoctor({
      iosInfoPlist: "<plist/>",
      hasPrivacyManifest: false,
      dependencies: ["@capacitor/preferences"],
    })
    expect(d?.severity).toBe("error")
    expect(d?.fix).toContain("adaptv build ios")
  })

  it("is quiet when no installed plugin creates the obligation", () => {
    expect(
      runDoctor({
        iosInfoPlist: "<plist/>",
        hasPrivacyManifest: false,
        dependencies: ["@capacitor/haptics"],
      }),
    ).toHaveLength(0)
  })

  it("says nothing to an app with no iOS project", () => {
    //`dependencies` now carries adaptv's own bundled plugins, and
    //`@capacitor/preferences` is in every app — so without the iOS gate this
    //would tell a web-only dev to fix an Apple submission they will never make.
    expect(
      runDoctor({
        hasPrivacyManifest: false,
        dependencies: ["@capacitor/preferences"],
      }),
    ).toHaveLength(0)
  })
})

describe("runDoctor — ordering and output", () => {
  it("reports errors before warnings", () => {
    const diagnostics = runDoctor({
      androidBuildGradle: "targetSdk = 34",
      iosInfoPlist: "WKAppBoundDomains",
      capacitorConfig: "{}",
    })
    expect(diagnostics[0]?.severity).toBe("error")
    expect(diagnostics[1]?.severity).toBe("warning")
  })

  it("says so plainly when everything is fine", () => {
    expect(formatDiagnostics([])).toContain("no issues")
  })

  it("prints the fix, not only the fault", () => {
    const output = formatDiagnostics(
      runDoctor({ androidBuildGradle: "targetSdk = 34" }),
    )
    expect(output).toContain("fix:")
  })
})
