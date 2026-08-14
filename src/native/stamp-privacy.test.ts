import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  registerPrivacyManifest,
  stampPrivacyManifest,
} from "#adaptv/native/stamp-privacy.ts"

/**
 * The shape of the Capacitor iOS template's `project.pbxproj`, trimmed to the four
 * places a bundled resource has to appear. Real ids, real tabs — the patcher
 * anchors on this text, so a fixture that only resembles it proves nothing.
 */
const PBXPROJ = `// !$*UTF8*$!
{
	archiveVersion = 1;
	objectVersion = 48;
	objects = {

/* Begin PBXBuildFile section */
		2FAD9763203C412B000D30F8 /* config.xml in Resources */ = {isa = PBXBuildFile; fileRef = 2FAD9762203C412B000D30F8 /* config.xml */; };
		504EC3081FED79650016851F /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 504EC3071FED79650016851F /* AppDelegate.swift */; };
/* End PBXBuildFile section */

/* Begin PBXFileReference section */
		2FAD9762203C412B000D30F8 /* config.xml */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = config.xml; sourceTree = "<group>"; };
		504EC3131FED79650016851F /* Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = Info.plist; sourceTree = "<group>"; };
/* End PBXFileReference section */

/* Begin PBXGroup section */
		504EC3061FED79650016851F /* App */ = {
			isa = PBXGroup;
			children = (
				504EC3131FED79650016851F /* Info.plist */,
				2FAD9762203C412B000D30F8 /* config.xml */,
			);
			path = App;
			sourceTree = "<group>";
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

/* Begin PBXSourcesBuildPhase section */
		504EC3011FED79650016851F /* Sources */ = {
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				504EC3081FED79650016851F /* AppDelegate.swift in Sources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		};
/* End PBXSourcesBuildPhase section */
	};
}
`

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** An app root, optionally with the iOS project `cap add ios` would have made. */
function scaffold({ ios = true, dependencies = {} } = {}) {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-privacy-"))
  roots.push(appRoot)
  writeFileSync(
    path.join(appRoot, "package.json"),
    JSON.stringify({ name: "app", dependencies }),
  )
  const iosApp = path.join(appRoot, ".adaptv/ios/App")
  if (ios) {
    mkdirSync(path.join(iosApp, "App"), { recursive: true })
    mkdirSync(path.join(iosApp, "App.xcodeproj"), { recursive: true })
    writeFileSync(
      path.join(iosApp, "App.xcodeproj/project.pbxproj"),
      PBXPROJ,
    )
  }
  return {
    appRoot,
    manifest: path.join(iosApp, "App/PrivacyInfo.xcprivacy"),
    pbxproj: path.join(iosApp, "App.xcodeproj/project.pbxproj"),
  }
}

/** The `files = (…)` list of one build phase, by its `isa`. */
function phaseFiles(project: string, isa: string): string {
  const body = project.slice(project.indexOf(`isa = ${isa};`))
  return body.slice(body.indexOf("files = ("), body.indexOf("));"))
}

describe("registerPrivacyManifest", () => {
  //THE bug this module exists to close a second time: for months the manifest was
  //written to disk and never declared here, so Xcode copied five other resources
  //into the `.app` and left this one behind — `doctor` green, submission rejected.
  it("puts the manifest in the RESOURCES phase, which is what copies it", () => {
    const out = registerPrivacyManifest(PBXPROJ)
    expect(phaseFiles(out, "PBXResourcesBuildPhase")).toContain(
      "PrivacyInfo.xcprivacy in Resources",
    )
    //and nowhere else: a resource in Sources is a compile error, not a copy
    expect(phaseFiles(out, "PBXSourcesBuildPhase")).not.toContain(
      "PrivacyInfo",
    )
  })

  it("declares the file reference and the build file that points at it", () => {
    const out = registerPrivacyManifest(PBXPROJ)
    const fileRef = out.match(
      /([0-9A-F]{24}) \/\* PrivacyInfo\.xcprivacy \*\/ = \{isa = PBXFileReference/,
    )?.[1]
    expect(fileRef).toBeDefined()
    //the build file must resolve to that exact reference — a dangling fileRef is a
    //project Xcode refuses to open
    expect(out).toContain(
      `{isa = PBXBuildFile; fileRef = ${fileRef} /* PrivacyInfo.xcprivacy */; }`,
    )
    //and the reference is in the App group, so it is visible in the navigator
    expect(out.slice(out.indexOf("isa = PBXGroup;"))).toContain(
      `${fileRef} /* PrivacyInfo.xcprivacy */,`,
    )
  })

  it("is idempotent — every build re-runs it and must not stack entries", () => {
    const once = registerPrivacyManifest(PBXPROJ)
    expect(registerPrivacyManifest(once)).toBe(once)
    //one of each object, not four more on every build: a duplicated build file is
    //"Multiple commands produce …App/PrivacyInfo.xcprivacy" and the build fails
    expect(
      once.match(/isa = PBXBuildFile; fileRef = ADA7C0DE/g),
    ).toHaveLength(1)
    expect(
      once.match(/ADA7C0DE\S* \/\* PrivacyInfo\.xcprivacy \*\/ = \{isa/g),
    ).toHaveLength(1)
  })

  it("throws rather than half-patching a project it does not recognise", () => {
    //A silent skip here would recreate the exact failure this module is for: a
    //build that looks fine and ships an app Apple rejects.
    const noResources = PBXPROJ.replace(
      "isa = PBXResourcesBuildPhase;",
      "isa = PBXCopyFilesBuildPhase;",
    )
    expect(() => registerPrivacyManifest(noResources)).toThrow(
      /PBXResourcesBuildPhase/,
    )
  })
})

describe("stampPrivacyManifest", () => {
  it("writes the manifest AND registers it, on the FIRST build", () => {
    //the reported bug: a fresh checkout produced an `.ipa` with no manifest at all,
    //because the stamp ran before `cap add ios` existed. It now runs after.
    const { appRoot, manifest, pbxproj } = scaffold({
      dependencies: { "@capacitor/filesystem": "8.0.0" },
    })
    const written = stampPrivacyManifest(appRoot)

    expect(written).toBe(".adaptv/ios/App/App/PrivacyInfo.xcprivacy")
    expect(readFileSync(manifest, "utf8")).toContain(
      "NSPrivacyAccessedAPICategoryFileTimestamp",
    )
    expect(
      phaseFiles(readFileSync(pbxproj, "utf8"), "PBXResourcesBuildPhase"),
    ).toContain("PrivacyInfo.xcprivacy in Resources")
  })

  it("declares adaptv's OWN plugins, which no app lists as dependencies", () => {
    //The manifest shipped EMPTY for every real app: the consumer's package.json
    //names `@arrzdev/adaptv` and no `@capacitor/*`, while the `.ipa` links
    //CapacitorPreferences.framework and reaches UserDefaults. An empty
    //NSPrivacyAccessedAPITypes there is not a safe default — it is a false
    //declaration, the one thing this generator set out never to make.
    const { appRoot, manifest } = scaffold({
      dependencies: { "@arrzdev/adaptv": "0.0.1", react: "19.0.0" },
    })
    stampPrivacyManifest(appRoot)

    const written = readFileSync(manifest, "utf8")
    expect(written).toContain("NSPrivacyAccessedAPICategoryUserDefaults")
    expect(written).toContain("CA92.1")
  })

  it("reports nothing on a second run — no Xcode watcher churn, no diff", () => {
    const { appRoot, pbxproj } = scaffold()
    stampPrivacyManifest(appRoot)
    const after = readFileSync(pbxproj, "utf8")

    expect(stampPrivacyManifest(appRoot)).toBeNull()
    expect(readFileSync(pbxproj, "utf8")).toBe(after)
  })

  it("re-registers a manifest whose project entry was lost", () => {
    //`.adaptv/ios` is regenerable and devs delete it; the file surviving a project
    //that no longer declares it is the silent state, so the two are checked apart.
    const { appRoot, pbxproj } = scaffold()
    stampPrivacyManifest(appRoot)
    writeFileSync(pbxproj, PBXPROJ)

    expect(stampPrivacyManifest(appRoot)).not.toBeNull()
    expect(readFileSync(pbxproj, "utf8")).toContain(
      "PrivacyInfo.xcprivacy",
    )
  })

  it("throws when there is no iOS project, instead of doing nothing", () => {
    //It used to return null here, and that silence WAS the bug — the caller now
    //scaffolds first, so reaching this means the ordering broke again.
    const { appRoot } = scaffold({ ios: false })
    expect(() => stampPrivacyManifest(appRoot)).toThrow(/scaffolded first/)
  })
})
