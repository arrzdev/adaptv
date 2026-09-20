import { describe, expect, it } from "vitest"
import {
  classListChanged,
  configIsStale,
  gradleProjectName,
  mergeCapacitorBuildGradle,
  mergeClassList,
  mergePbxprojResource,
  mergePluginsJson,
  mergeSettingsGradle,
  podsNeedInstall,
  resolvePluginPackages,
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

  it("catches a dev shell baked for another dev server (the app sat on the offline screen polling a port nothing served)", () => {
    expect(
      configIsStale(DEV, {
        ...DEV,
        server: { url: "http://localhost:41720", cleartext: true },
      }),
    ).toBe(true)
    expect(
      configIsStale(DEV, {
        ...DEV,
        server: { url: "http://192.168.1.18:41710" },
      }),
    ).toBe(true)
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

/* The Android trio. The bug: `capacitor.settings.gradle` listed exactly ONE plugin project —
 * `capacitor-device`, the only `@capacitor/*` the consumer app declared itself — so adaptv's
 * own 12 were never compiled into the APK and every native call rejected with
 * `"X" plugin is not implemented on android`. iOS was fine, because adaptv had been injecting
 * the Podfile all along; nothing did the equivalent here. */

// What `cap sync` writes on its own, verbatim from a real project.
const CAP_SETTINGS = `// DO NOT EDIT THIS FILE! IT IS GENERATED EACH TIME "capacitor update" IS RUN
include ':capacitor-android'
project(':capacitor-android').projectDir = new File('../../../../../node_modules/.pnpm/@capacitor+android@8.4.2/node_modules/@capacitor/android/capacitor')

include ':capacitor-device'
project(':capacitor-device').projectDir = new File('../../../../node_modules/.pnpm/@capacitor+device@8.0.3/node_modules/@capacitor/device/android')
`

describe("gradleProjectName — the module name has to match cap's byte for byte", () => {
  it("mirrors @capacitor/cli's getGradlePackageName", () => {
    expect(gradleProjectName("@capacitor/status-bar")).toBe(
      "capacitor-status-bar",
    )
    expect(gradleProjectName("@capacitor/app")).toBe("capacitor-app")
  })

  it("handles an unscoped package (a consumer-registered plugin need not be scoped)", () => {
    expect(gradleProjectName("cordova-plugin-thing")).toBe(
      "cordova-plugin-thing",
    )
  })
})

describe("mergeSettingsGradle — the 12 missing plugin projects", () => {
  const ADAPTV = [
    { project: "capacitor-haptics", dir: "../../x/haptics/android" },
    { project: "capacitor-status-bar", dir: "../../x/status-bar/android" },
  ]

  it("declares adaptv's plugin modules alongside the one cap found", () => {
    const out = mergeSettingsGradle(CAP_SETTINGS, ADAPTV)
    expect(out).toContain("include ':capacitor-haptics'")
    expect(out).toContain(
      "project(':capacitor-haptics').projectDir = new File('../../x/haptics/android')",
    )
    expect(out).toContain("include ':capacitor-status-bar'")
    // and leaves cap's own entries alone
    expect(out).toContain("include ':capacitor-android'")
    expect(out).toContain("include ':capacitor-device'")
  })

  it("is idempotent — cap rewrites this file every sync, and a Gradle build fails outright on a duplicated `include`", () => {
    const once = mergeSettingsGradle(CAP_SETTINGS, ADAPTV)
    expect(mergeSettingsGradle(once, ADAPTV)).toBe(once)
  })

  it("REWRITES a projectDir that moved instead of skipping it — the path points into pnpm's store, so a version bump relocates it, and a cached sync would otherwise leave Gradle pointing at a directory that no longer exists", () => {
    const once = mergeSettingsGradle(CAP_SETTINGS, ADAPTV)
    const moved = mergeSettingsGradle(once, [
      {
        project: "capacitor-haptics",
        dir: "../../y/haptics@8.0.3/android",
      },
    ])
    expect(moved).toContain(
      "project(':capacitor-haptics').projectDir = new File('../../y/haptics@8.0.3/android')",
    )
    expect(moved).not.toContain("../../x/haptics/android")
    // still exactly one declaration of it
    expect(moved.match(/include ':capacitor-haptics'/g)).toHaveLength(1)
  })

  it("adds nothing when there is nothing to add", () => {
    expect(mergeSettingsGradle(CAP_SETTINGS, [])).toBe(CAP_SETTINGS)
  })
})

describe("mergeCapacitorBuildGradle — a module in the build that nothing depends on", () => {
  const CAP_BUILD = `// DO NOT EDIT THIS FILE! IT IS GENERATED EACH TIME "capacitor update" IS RUN

android {
  compileOptions {
      sourceCompatibility JavaVersion.VERSION_21
      targetCompatibility JavaVersion.VERSION_21
  }
}

apply from: "../capacitor-cordova-android-plugins/cordova.variables.gradle"
dependencies {
    implementation project(':capacitor-device')

}
`

  it("makes the app module depend on adaptv's plugin modules", () => {
    const out = mergeCapacitorBuildGradle(CAP_BUILD, [
      "capacitor-haptics",
      "capacitor-device",
    ])
    expect(out).toContain("implementation project(':capacitor-haptics')")
    // cap already declared device — not added twice
    expect(
      out.match(/implementation project\(':capacitor-device'\)/g),
    ).toHaveLength(1)
  })

  it("keeps the Cordova lines cap puts in the same file — regenerating it from scratch dropped them", () => {
    const out = mergeCapacitorBuildGradle(CAP_BUILD, ["capacitor-haptics"])
    expect(out).toContain(
      'apply from: "../capacitor-cordova-android-plugins/cordova.variables.gradle"',
    )
    expect(out).toContain("sourceCompatibility JavaVersion.VERSION_21")
  })

  it("is idempotent", () => {
    const once = mergeCapacitorBuildGradle(CAP_BUILD, [
      "capacitor-haptics",
    ])
    expect(mergeCapacitorBuildGradle(once, ["capacitor-haptics"])).toBe(
      once,
    )
  })
})

describe("mergePluginsJson — compiled in, but never registered", () => {
  const CAP_FOUND = [
    {
      pkg: "@capacitor/device",
      classpath: "com.capacitorjs.plugins.device.DevicePlugin",
    },
  ]
  const ADAPTV = [
    {
      pkg: "@capacitor/haptics",
      classpath: "com.capacitorjs.plugins.haptics.HapticsPlugin",
    },
  ]

  it("registers adaptv's plugins with the bridge — this is the file that decides whether Haptics.impact() resolves or rejects with 'not implemented on android'", () => {
    expect(mergePluginsJson(CAP_FOUND, ADAPTV)).toEqual([
      ...CAP_FOUND,
      ...ADAPTV,
    ])
  })

  it("is idempotent, for the same reason mergeClassList is", () => {
    const once = mergePluginsJson(CAP_FOUND, ADAPTV)
    expect(mergePluginsJson(once, ADAPTV)).toEqual(once)
  })

  it("survives a project with no registry yet, and drops junk entries", () => {
    expect(mergePluginsJson(undefined, ADAPTV)).toEqual(ADAPTV)
    expect(mergePluginsJson([{ pkg: "x" }], ADAPTV)).toEqual(ADAPTV)
  })
})

/* The set both injectors declare. The case that matters is an app listing a plugin adaptv
 * already ships: the playground's config did exactly that, which is what makes it worth a
 * function instead of two inline `seen` sets that can drift apart. */
describe("resolvePluginPackages — adaptv's set plus the app's, declared once each", () => {
  const BASE = ["@capacitor/device", "@capacitor/haptics"]

  it("declares a plugin the app re-lists exactly once (a duplicate pod fails `pod install`; a duplicate gradle project fails the build)", () => {
    expect(
      resolvePluginPackages(BASE, ["@capacitor/device"]).packages,
    ).toEqual(BASE)
  })

  it("appends a genuine extra after the base set, so adaptv's own plugins keep their order", () => {
    expect(
      resolvePluginPackages(BASE, ["@capacitor/camera"]).packages,
    ).toEqual([...BASE, "@capacitor/camera"])
  })

  it("dedupes within the app's own list too — an unscoped or repeated entry is still one plugin", () => {
    expect(
      resolvePluginPackages(BASE, [
        "cordova-plugin-thing",
        "cordova-plugin-thing",
      ]).packages,
    ).toEqual([...BASE, "cordova-plugin-thing"])
  })

  it("never drops one of adaptv's own, whatever the app passes", () => {
    expect(resolvePluginPackages(BASE, []).packages).toEqual(BASE)
    expect(resolvePluginPackages(BASE, undefined).packages).toEqual(BASE)
    expect(resolvePluginPackages(BASE, [""]).packages).toEqual(BASE)
  })

  /* `extras` decides whether the CLI says `linking plugins` at all. It used to be
   * `plugins.length > 0`, which announced linking for a config listing a plugin adaptv
   * already bundles — a line about work that did not happen. */
  it("counts only what the dev actually added, so a re-listed base plugin says nothing", () => {
    expect(
      resolvePluginPackages(BASE, ["@capacitor/device"]).extras,
    ).toEqual([])
    expect(resolvePluginPackages(BASE, []).extras).toEqual([])
  })

  it("counts a genuine extra, which is the one case the CLI may report", () => {
    expect(
      resolvePluginPackages(BASE, [
        "@capacitor/camera",
        "@capacitor/device",
      ]).extras,
    ).toEqual(["@capacitor/camera"])
  })
})

/* The privacy manifest was generated correctly and never shipped: Xcode copies a file into
 * the .app only if the target's Resources phase lists it, and nothing listed this one. No
 * build error, nothing visible in the project — just an App Store rejection much later. */
describe("mergePbxprojResource — on disk is not the same as in the bundle", () => {
  // The Capacitor template, cut to the four lists that matter.
  const PBXPROJ = `// !$*UTF8*$!
{
	objects = {

/* Begin PBXBuildFile section */
		2FAD9763203C412B000D30F8 /* config.xml in Resources */ = {isa = PBXBuildFile; fileRef = 2FAD9762203C412B000D30F8 /* config.xml */; };
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
		504EC3131FED79650016851F /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };
/* End PBXFileReference section */

/* Begin PBXGroup section */
		504EC3061FED79650016851F /* App */ = {
			isa = PBXGroup;
			children = (
				504EC3131FED79650016851F /* Info.plist */,
			);
		};
/* End PBXGroup section */

/* Begin PBXResourcesBuildPhase section */
		504EC3021FED79650016851F /* Resources */ = {
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				2FAD9763203C412B000D30F8 /* config.xml in Resources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXResourcesBuildPhase section */
	};
}
`
  const ENTRY = {
    name: "PrivacyInfo.xcprivacy",
    fileType: "text.xml",
    buildFileId: "AAAAAAAAAAAAAAAAAAAAAAA1",
    fileRefId: "BBBBBBBBBBBBBBBBBBBBBBB2",
  }

  it("lists the file in the Resources phase — the one edit that decides whether it ships", () => {
    const out = mergePbxprojResource(PBXPROJ, ENTRY)
    const phase = out.slice(out.indexOf("isa = PBXResourcesBuildPhase;"))
    expect(phase).toContain(
      `${ENTRY.buildFileId} /* PrivacyInfo.xcprivacy in Resources */,`,
    )
  })

  it("declares the build file and the file reference it points at", () => {
    const out = mergePbxprojResource(PBXPROJ, ENTRY)
    expect(out).toContain(
      `${ENTRY.buildFileId} /* PrivacyInfo.xcprivacy in Resources */ = {isa = PBXBuildFile; fileRef = ${ENTRY.fileRefId} /* PrivacyInfo.xcprivacy */; };`,
    )
    expect(out).toContain(
      `${ENTRY.fileRefId} /* PrivacyInfo.xcprivacy */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = PrivacyInfo.xcprivacy; sourceTree = "<group>"; };`,
    )
  })

  it("puts it beside Info.plist in the navigator, where a dev would look for it", () => {
    const out = mergePbxprojResource(PBXPROJ, ENTRY)
    const group = out.slice(
      out.indexOf("/* Begin PBXGroup section */"),
      out.indexOf("/* End PBXGroup section */"),
    )
    expect(group).toContain(
      `${ENTRY.fileRefId} /* PrivacyInfo.xcprivacy */,`,
    )
  })

  it("is idempotent — this runs after every sync, and a second declaration is a corrupt project", () => {
    const once = mergePbxprojResource(PBXPROJ, ENTRY)
    expect(mergePbxprojResource(once, ENTRY)).toBe(once)
  })

  it("leaves a project it does not recognise completely alone", () => {
    //half-patching someone's Xcode project is worse than not patching it
    expect(mergePbxprojResource("{ not an xcode project }", ENTRY)).toBe(
      "{ not an xcode project }",
    )
    expect(mergePbxprojResource(undefined, ENTRY)).toBe("")
  })
})
