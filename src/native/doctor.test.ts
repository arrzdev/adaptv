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
    //`isNativePlatform()`, not the bridge's own `getPlatform()`: it is adaptv's answer to
    //the same question, exported to consumers from `@arrzdev/adaptv/utils`, and it degrades
    //identically here because it wraps the bridge. Naming a symbol the dev cannot import
    //from adaptv would send them somewhere adaptv does not go.
    expect(d?.detail).toContain("isNativePlatform()")
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
  it("errors whenever an iOS project has none — the app never has to name a plugin for the obligation to exist", () => {
    //the rule used to require @capacitor/preferences etc. in the APP's dependencies,
    //where they never are: adaptv owns Capacitor, so they are adaptv's dependencies.
    //Every native adaptv app compiles in device + preferences, so the manifest is
    //always required and this never fired for anyone.
    const [d] = runDoctor({ hasPrivacyManifest: false })
    expect(d?.severity).toBe("error")
    expect(d?.fix).toContain("adaptv build ios")
  })

  it("is quiet when the manifest is there", () => {
    expect(runDoctor({ hasPrivacyManifest: true })).toHaveLength(0)
  })

  it("is quiet when there is no iOS project to have one (a web-only app)", () => {
    //`undefined`, not `false` — the CLI only answers the question when
    //`.adaptv/ios/App` exists
    expect(runDoctor({})).toHaveLength(0)
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

describe("what a diagnostic is allowed to say (R8)", () => {
  //`doctor` output is a surface the dev reads, so the opacity rule governs it: the
  //message names the mechanism, never whose code implements it. The scan itself lives in
  //`bin/lib/opacity.test.mjs`, beside the one guarding the manifest, because it needs the
  //repo's own `namesPlumbing` and a TS test cannot import an untyped `.mjs`. What stays
  //here is the other half: that satisfying the rule did not cost the diagnosis.
  const everyDiagnostic = runDoctor({
    iosInfoPlist: "<key>WKAppBoundDomains</key><array/>",
    capacitorConfig: "{}",
    androidBuildGradle: "targetSdk = 34",
    hasPrivacyManifest: false,
  })

  it("fires every check, so the scan below is not vacuous", () => {
    expect(everyDiagnostic).toHaveLength(3)
  })

  it("still names the mechanism and adaptv's own platform answer", () => {
    //The reason this is not a find-and-replace: strip the mechanism to satisfy the rule
    //above and the worst failure the native surface can report stops diagnosing anything.
    const [appBound] = everyDiagnostic
    expect(appBound?.detail).toContain("WKUserScript")
    expect(appBound?.detail).toContain("isNativePlatform()")
  })

  it("uses no em dash, which the house copy rules ban", () => {
    for (const d of everyDiagnostic) {
      expect(`${d.title} ${d.detail} ${d.fix}`).not.toContain("\u2014")
    }
  })
})
