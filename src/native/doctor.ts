/**
 * `adaptv doctor` — detect the silent failures. → `docs/decisions/register.md` B22, B21, §6.0
 *
 * Every check here shares one property: **the broken state still builds, and
 * often still runs.** That is the whole selection criterion. A misconfiguration
 * that fails loudly needs no doctor; these produce an app that looks fine and is
 * wrong, sometimes only on a user's device.
 */

import {
  ANDROID_SDK_LEVELS,
  readAndroidTargetSdk,
} from "#adaptv/native/android-sdk.ts"

export type DiagnosticSeverity = "error" | "warning"

export type Diagnostic = {
  severity: DiagnosticSeverity
  title: string
  /** What actually goes wrong, concretely. */
  detail: string
  /** What to do about it. */
  fix: string
}

export type DoctorInput = {
  /** Raw `.adaptv/ios/App/App/Info.plist`, if present. */
  iosInfoPlist?: string
  /** Raw generated `capacitor.config.json`, if present. */
  capacitorConfig?: string
  /**
   * Raw `.adaptv/android/variables.gradle`, if present — the file that carries the
   * numbers; `app/build.gradle` only references them (`rootProject.ext.targetSdkVersion`),
   * which is why reading it made the target SDK check dead for the life of the project.
   */
  androidVariablesGradle?: string
  /** Whether `.adaptv/ios/App/App/PrivacyInfo.xcprivacy` exists. */
  hasPrivacyManifest?: boolean
}

/**
 * The `WKAppBoundDomains` trap — B22, and the worst failure in the Capacitor
 * surface.
 *
 * If that key is in `Info.plist` **without**
 * `ios.limitsNavigationsToAppBoundDomains: true`, WebKit refuses `WKUserScript`
 * injection — which is exactly how Capacitor injects `native-bridge.js`. The
 * result: `Capacitor.getPlatform()` returns `"web"` and **every plugin silently
 * falls back to its web implementation**. No error, no warning, no crash. An
 * Ionic maintainer confirmed this is the mechanism behind issues #4721, #5764 and
 * #4913.
 *
 * Worse, the reason people add the key mostly doesn't exist: the widely-repeated
 * claim that app-bound domains relax ITP's 7-day storage cap is contradicted by
 * WebKit source, where `isAppBoundITPRelaxationEnabled` is a `constexpr false`.
 */
function checkAppBoundDomains(input: DoctorInput): Diagnostic | null {
  const plist = input.iosInfoPlist
  if (!plist?.includes("WKAppBoundDomains")) return null

  const optedIn = input.capacitorConfig?.includes(
    "limitsNavigationsToAppBoundDomains",
  )
  if (optedIn) return null

  return {
    severity: "error",
    title: "WKAppBoundDomains is set without the matching adaptv opt-in",
    detail:
      "WebKit will refuse WKUserScript injection, which is how the native bridge reaches " +
      "the page. 'isNativePlatform()' will return false and EVERY native capability will " +
      "silently fall back to its web implementation. No error, no crash, just an app that " +
      "quietly has none of the native surface it was built for.",
    fix:
      "Remove WKAppBoundDomains from .adaptv/ios/App/App/Info.plist. adaptv never adds it, and the " +
      "usual reason for adding it (relaxing ITP's storage cap) does not work: WebKit's " +
      "isAppBoundITPRelaxationEnabled is a constexpr false. If you genuinely need it, also " +
      "set 'ios.limitsNavigationsToAppBoundDomains: true' in adaptv.config.ts.",
  }
}

/**
 * Android 16 / target API 36 — §6.0. Google Play's deadline was **2026-08-31**
 * (extensions ran to 2026-11-01); it is behind us.
 *
 * API 36 removes the edge-to-edge opt-out entirely, and
 * `setStatusBarColor`/`setNavigationBarColor` become no-ops rather than errors.
 * An app that relies on them keeps compiling and simply stops tinting.
 *
 * The level is a value adaptv OWNS: `ANDROID_SDK_LEVELS` in `android-sdk.ts` is the
 * one place it lives, and every android prepare stamps it into the project
 * (`stampAndroidSdkLevels`, from `bin/lib/native.mjs`). So this rule can only fire in
 * the gap that stamp has not yet closed — a project scaffolded before adaptv carried
 * the level, or a hand edit since the last run — and its fix is to run, not to edit.
 *
 * It reads `variables.gradle`, the file that carries the number. It used to be fed
 * `app/build.gradle`, whose only mention is `targetSdkVersion
 * rootProject.ext.targetSdkVersion` — a reference, no digits — so the regex never
 * matched on a real project and the check was dead for as long as it existed.
 */
function checkAndroidTargetSdk(input: DoctorInput): Diagnostic | null {
  const variables = input.androidVariablesGradle
  if (!variables) return null
  const required = ANDROID_SDK_LEVELS.target
  const target = readAndroidTargetSdk(variables)
  if (target === null || target >= required) return null

  return {
    severity: "warning",
    title: `Android target SDK is ${target} in .adaptv/android/variables.gradle; Google Play requires ${required}`,
    detail:
      "Google Play's deadline was 2026-08-31 (extensions to 2026-11-01). API 36 also " +
      "removes the edge-to-edge opt-out, and setStatusBarColor / setNavigationBarColor " +
      "become NO-OPS rather than errors, so an app relying on them keeps compiling and " +
      "silently stops tinting.",
    fix:
      `Nothing to edit: adaptv raises it to ${required} on the next 'adaptv dev android', ` +
      "'adaptv preview android' or 'adaptv build android'. A level lowered by hand in " +
      ".adaptv/android/variables.gradle is raised the same way on the next run, so it " +
      "cannot hold. Status-bar tinting belongs in CSS: viewport-fit=cover plus a " +
      "background painted under the inset is the only portable approach left.",
  }
}

//No `viewport-fit=cover` check: Capacitor hard-gates safe-area insets on that
//exact string, but adaptv GENERATES the viewport meta in its app shell, so it
//cannot be wrong. A doctor rule for a value the framework owns would only ever
//fire on a bug in adaptv itself — and it would report it as the user's problem.
//
//The target SDK above is adaptv's value too, and the rule stays for a different
//reason: the viewport meta is regenerated on every build, but the Android project
//is written once and persists on disk, so the file can lag the framework until the
//next android run stamps it. The rule reports that lag, and its fix says to run.
//
//The tag being right is not the same as Capacitor SEEING it right, though:
//SystemBars reads it once, from a DOMContentLoaded listener, and losing that race
//costs the app edge-to-edge for the whole process (grey status-bar band, insets
//reported as 0). That failure is invisible to a file-reading doctor — it is a
//runtime ordering fact — so it is fixed at the source instead, by re-probing from
//`capabilities/status-bar.ts` until a pass lands.

/**
 * The privacy manifest — §5.0.1. Fails at submission, not at build.
 *
 * Unconditional, and that is the fix for the version that wasn't: this used to fire only
 * when the APP's dependencies named a plugin with a required-reason API, which no adaptv
 * app ever does — adaptv owns Capacitor, so the plugins are adaptv's dependencies. Every
 * native adaptv app compiles in `@capacitor/device` (system boot time) and
 * `@capacitor/preferences` (UserDefaults), so an iOS project without a manifest is always
 * wrong and the rule never needed a condition.
 */
function checkPrivacyManifest(input: DoctorInput): Diagnostic | null {
  if (input.hasPrivacyManifest !== false) return null

  return {
    severity: "error",
    title: ".adaptv/ios/App/App/PrivacyInfo.xcprivacy is missing",
    detail:
      "The plugins adaptv compiles in touch Apple required-reason APIs. The manifest is not " +
      "checked at build time, so App Store Connect rejects the upload with a generic message, days later.",
    fix: "Run `adaptv build ios` (or `adaptv preview ios`), which regenerates it from the installed plugin set.",
  }
}

/**
 * Run every check. Returns diagnostics ordered errors-first.
 *
 * Pure: takes file contents rather than reading them, so the whole rule set is
 * testable without a native project on disk.
 */
export function runDoctor(input: DoctorInput): Diagnostic[] {
  const checks = [
    checkAppBoundDomains,
    checkAndroidTargetSdk,
    checkPrivacyManifest,
  ]

  return checks
    .map((check) => check(input))
    .filter((d): d is Diagnostic => d !== null)
    .sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1,
    )
}

/** Format diagnostics for the terminal. */
export function formatDiagnostics(
  diagnostics: readonly Diagnostic[],
): string {
  if (diagnostics.length === 0) {
    return "[adaptv] doctor: no issues found."
  }
  return diagnostics
    .map((d) =>
      [
        `${d.severity === "error" ? "✗" : "!"} ${d.title}`,
        `  ${d.detail}`,
        `  fix: ${d.fix}`,
      ].join("\n"),
    )
    .join("\n\n")
}
