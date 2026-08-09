// The bug this file is about: the generated `PrivacyInfo.xcprivacy` was derived from the APP's
// `package.json`, and an adaptv app declares no `@capacitor/*` at all — adaptv owns Capacitor,
// so the plugins are adaptv's dependencies. Every manifest adaptv ever wrote therefore said the
// app touches NO required-reason API, while the binary shipped `@capacitor/device` (system boot
// time) and `@capacitor/preferences` (UserDefaults). It fails at App Store submission, days
// later, with a generic message.
//
// So the assertions below are mostly "with an app that names nothing, is it still declared?"
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
  resetPrivacyManifestStamps,
  stampPrivacyManifest,
} from "#adaptv/native/stamp-privacy.ts"

let appRoot: string | null = null
afterEach(() => {
  if (appRoot) rmSync(appRoot, { recursive: true, force: true })
  appRoot = null
  resetPrivacyManifestStamps()
})

/** An app with an iOS project and a `package.json` that declares no plugin of its own. */
function scaffold(): string {
  appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-privacy-"))
  writeFileSync(
    path.join(appRoot, "package.json"),
    JSON.stringify({
      name: "scratch-app",
      dependencies: { react: "19.2.3" },
    }),
  )
  mkdirSync(path.join(appRoot, ".adaptv/ios/App/App"), { recursive: true })
  return appRoot
}

const manifest = (root: string) =>
  readFileSync(
    path.join(root, ".adaptv/ios/App/App/PrivacyInfo.xcprivacy"),
    "utf8",
  )

describe("stampPrivacyManifest — the plugins adaptv itself compiles in", () => {
  it("declares system boot time for @capacitor/device, which the app never named", () => {
    const root = scaffold()
    expect(stampPrivacyManifest(root)).not.toBeNull()

    const xml = manifest(root)
    expect(xml).toContain(
      "<string>NSPrivacyAccessedAPICategorySystemBootTime</string>",
    )
    expect(xml).toContain("<string>35F9.1</string>")
  })

  it("declares UserDefaults for @capacitor/preferences, same reason", () => {
    const root = scaffold()
    stampPrivacyManifest(root)

    const xml = manifest(root)
    expect(xml).toContain(
      "<string>NSPrivacyAccessedAPICategoryUserDefaults</string>",
    )
    expect(xml).toContain("<string>CA92.1</string>")
  })

  it("writes nothing when there is no iOS project", () => {
    appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-privacy-"))
    expect(stampPrivacyManifest(appRoot)).toBeNull()
  })

  it("is idempotent — the second stamp finds the file already correct", () => {
    const root = scaffold()
    stampPrivacyManifest(root)
    const first = manifest(root)
    resetPrivacyManifestStamps()
    //null = "nothing written", not "nothing found": the content is unchanged
    expect(stampPrivacyManifest(root)).toBeNull()
    expect(manifest(root)).toBe(first)
  })
})

describe("stampPrivacyManifest — what the app adds", () => {
  it("merges the app's own required-reason declaration with the derived ones", () => {
    const root = scaffold()
    stampPrivacyManifest(root, {
      privacy: {
        requiredReasonAPIs: {
          NSPrivacyAccessedAPICategoryFileTimestamp: ["C617.1"],
        },
      },
    })

    const xml = manifest(root)
    expect(xml).toContain(
      "<string>NSPrivacyAccessedAPICategoryFileTimestamp</string>",
    )
    //and the derived ones survive it
    expect(xml).toContain(
      "<string>NSPrivacyAccessedAPICategorySystemBootTime</string>",
    )
  })

  it("carries the app's tracking and collected-data declarations into the file", () => {
    const root = scaffold()
    stampPrivacyManifest(root, {
      privacy: {
        tracking: true,
        trackingDomains: ["metrics.example.com"],
        collectedData: [
          {
            type: "NSPrivacyCollectedDataTypeEmailAddress",
            linked: true,
            tracking: false,
            purposes: [
              "NSPrivacyCollectedDataTypePurposeAppFunctionality",
            ],
          },
        ],
      },
    })

    const xml = manifest(root)
    expect(xml).toContain("<key>NSPrivacyTracking</key>\n\t<true/>")
    expect(xml).toContain("<string>metrics.example.com</string>")
    expect(xml).toContain(
      "<string>NSPrivacyCollectedDataTypeEmailAddress</string>",
    )
  })

  it("reads a registered plugin's OWN manifest, for a plugin adaptv's table has never heard of", () => {
    const root = scaffold()
    //a real installed package, resolved from the app root exactly as the build would
    const pluginDir = path.join(root, "node_modules/@vendor/scanner")
    mkdirSync(path.join(pluginDir, "ios/Sources/ScannerPlugin"), {
      recursive: true,
    })
    writeFileSync(
      path.join(pluginDir, "package.json"),
      JSON.stringify({ name: "@vendor/scanner", version: "1.0.0" }),
    )
    writeFileSync(
      path.join(
        pluginDir,
        "ios/Sources/ScannerPlugin/PrivacyInfo.xcprivacy",
      ),
      `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>NSPrivacyAccessedAPITypes</key>
	<array>
		<dict>
			<key>NSPrivacyAccessedAPIType</key>
			<string>NSPrivacyAccessedAPICategoryDiskSpace</string>
			<key>NSPrivacyAccessedAPITypeReasons</key>
			<array>
				<string>E174.1</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`,
    )

    stampPrivacyManifest(root, { plugins: ["@vendor/scanner"] })

    const xml = manifest(root)
    expect(xml).toContain(
      "<string>NSPrivacyAccessedAPICategoryDiskSpace</string>",
    )
    expect(xml).toContain("<string>E174.1</string>")
  })

  it("ignores a registered plugin that ships no manifest and isn't in the table", () => {
    const root = scaffold()
    const pluginDir = path.join(root, "node_modules/@vendor/quiet")
    mkdirSync(path.join(pluginDir, "ios"), { recursive: true })
    writeFileSync(
      path.join(pluginDir, "package.json"),
      JSON.stringify({ name: "@vendor/quiet", version: "1.0.0" }),
    )

    stampPrivacyManifest(root, { plugins: ["@vendor/quiet"] })
    //no invented declaration, and the derived ones are untouched
    expect(manifest(root)).toContain(
      "<string>NSPrivacyAccessedAPICategorySystemBootTime</string>",
    )
  })

  it("survives a plugin that isn't installed at all", () => {
    const root = scaffold()
    expect(() =>
      stampPrivacyManifest(root, { plugins: ["@vendor/not-installed"] }),
    ).not.toThrow()
    expect(manifest(root)).toContain("NSPrivacyAccessedAPITypes")
  })
})
