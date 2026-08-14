import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { linkedDependencies } from "#adaptv/native/plugins.ts"
import {
  renderPrivacyManifest,
  resolveRequiredReasons,
} from "#adaptv/native/privacy-manifest.ts"
import { ADAPTV_DIR } from "#adaptv/vite/adaptv-dir.ts"

/** The filename Apple looks for, at the root of the built `.app`. */
const MANIFEST = "PrivacyInfo.xcprivacy"

//Deterministic Xcode object ids for the two entries adaptv adds. Xcode generates
//24-char uppercase hex; these are hex too but spell `ADA7C0DE`, so a human reading
//a diff can tell adaptv's rows from Xcode's, and re-running never invents new ones.
const FILE_REF_ID = "ADA7C0DE0000000000000001"
const BUILD_FILE_ID = "ADA7C0DE0000000000000002"

/**
 * Write `.adaptv/ios/App/App/PrivacyInfo.xcprivacy` from the app's installed
 * dependencies **and register it in the Xcode project**. → `DECISIONS.md §5.0.1`
 *
 * Both halves, because for months this only did the first one and the file never
 * reached a single `.ipa`. Xcode copies what the project DECLARES, and the
 * Capacitor template's `Resources` build phase lists six items, none of them this
 * one — so `adaptv doctor` reported the manifest green off the filesystem while
 * every build shipped an app without it. A generated file is not a shipped file.
 *
 * Runs from the CLI's `preparePlatform`, right after the native project is
 * scaffolded — NOT from the Vite plugin, where it used to live. Two reasons, both
 * measured: on a first build in a fresh checkout the plugin ran before
 * `cap add ios` existed and silently no-opped, so the first `.ipa` a dev ever
 * produced was the one that got rejected; and on a warm build the web bundle is
 * fingerprint-cached, so Vite does not run at all and the stamp never fired.
 * `preparePlatform` is the one definition of "ready to sync" and has neither
 * problem.
 *
 * Idempotent on both files: unchanged content is not rewritten, so it does not
 * churn Xcode's file watcher or show up as a spurious diff on every build.
 *
 * @returns the app-root-relative manifest path if this call changed anything,
 * `null` if both files were already correct.
 */
export function stampPrivacyManifest(appRoot: string): string | null {
  const iosApp = path.resolve(appRoot, ADAPTV_DIR, "ios/App")
  //A precondition, not a branch. The caller scaffolds first; if this is ever
  //false again it is the ordering bug above coming back, and it must be loud —
  //silence here is what shipped non-compliant apps in the first place.
  if (!existsSync(iosApp)) {
    throw new Error(
      `cannot write ${MANIFEST}: no iOS project at ${ADAPTV_DIR}/ios/App (it must be scaffolded first)`,
    )
  }

  //adaptv's OWN plugins, not just the app's package.json — the consumer installs
  //none of them and they are linked into every build. → native/plugins.ts
  const contents = renderPrivacyManifest(
    resolveRequiredReasons(
      linkedDependencies(installedDependencies(appRoot)),
    ),
  )
  const target = path.join(iosApp, "App", MANIFEST)
  let changed = false

  if (!(existsSync(target) && readFileSync(target, "utf8") === contents)) {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, contents)
    changed = true
  }

  const pbxproj = path.join(iosApp, "App.xcodeproj/project.pbxproj")
  const project = readFileSync(pbxproj, "utf8")
  const registered = registerPrivacyManifest(project)
  if (registered !== project) {
    writeFileSync(pbxproj, registered)
    changed = true
  }

  return changed ? path.join(ADAPTV_DIR, "ios/App/App", MANIFEST) : null
}

/**
 * Add `PrivacyInfo.xcprivacy` to the app target's resources in a `project.pbxproj`.
 *
 * Four insertions, because that is what a bundled resource is in this format: the
 * file reference, the build file that points at it, its slot in the `Resources`
 * build phase (the one that actually copies it), and its row in the `App` group
 * (cosmetic — it is what makes the file visible in Xcode's navigator).
 *
 * Every anchor is REQUIRED. If the Capacitor template ever reshapes the project
 * this throws instead of returning a half-patched file: the whole point of this
 * module is that a missing manifest fails silently at submission, and a silent
 * skip here would reproduce that exactly one level up.
 *
 * Pure and idempotent — returns the input unchanged once the manifest is in.
 */
export function registerPrivacyManifest(project: string): string {
  if (project.includes(MANIFEST)) return project

  let out = project
  out = insertAfter(
    out,
    /\/\* Begin PBXBuildFile section \*\/\n/,
    `\t\t${BUILD_FILE_ID} /* ${MANIFEST} in Resources */ = {isa = PBXBuildFile; fileRef = ${FILE_REF_ID} /* ${MANIFEST} */; };\n`,
    "PBXBuildFile section",
  )
  out = insertAfter(
    out,
    /\/\* Begin PBXFileReference section \*\/\n/,
    `\t\t${FILE_REF_ID} /* ${MANIFEST} */ = {isa = PBXFileReference; lastKnownFileType = text.xml; path = ${MANIFEST}; sourceTree = "<group>"; };\n`,
    "PBXFileReference section",
  )
  //The copy itself. Lazy up to the FIRST `files = (` after the phase opens, so it
  //lands in the resources list and not in Sources or Frameworks.
  out = insertAfter(
    out,
    /isa = PBXResourcesBuildPhase;[\s\S]*?files = \(\n/,
    `\t\t\t\t${BUILD_FILE_ID} /* ${MANIFEST} in Resources */,\n`,
    "PBXResourcesBuildPhase",
  )
  //Alongside Info.plist: the same group, and the same kind of file — a plist the
  //app target owns and nothing imports.
  out = insertAfter(
    out,
    /\n\t+[0-9A-F]{24} \/\* Info\.plist \*\/,\n/,
    `\t\t\t\t${FILE_REF_ID} /* ${MANIFEST} */,\n`,
    "App group",
  )
  return out
}

function insertAfter(
  project: string,
  anchor: RegExp,
  line: string,
  what: string,
): string {
  const match = project.match(anchor)
  if (!match || match.index === undefined) {
    throw new Error(
      `cannot register ${MANIFEST}: the Xcode project has no ${what}`,
    )
  }
  const at = match.index + match[0].length
  return project.slice(0, at) + line + project.slice(at)
}

/** Every package name in the app's `package.json`, both kinds. Empty if unreadable. */
function installedDependencies(appRoot: string): string[] {
  try {
    const pkg = JSON.parse(
      readFileSync(path.resolve(appRoot, "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    return [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]
  } catch {
    return []
  }
}
