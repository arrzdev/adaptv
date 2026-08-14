/**
 * `adaptv doctor` — detect the silent failures. → `DECISIONS.md` B22, B21, §6.0
 *
 * Every check here shares one property: **the broken state still builds, and
 * often still runs.** That is the whole selection criterion. A misconfiguration
 * that fails loudly needs no doctor; these produce an app that looks fine and is
 * wrong, sometimes only on a user's device.
 */

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
  /** `.adaptv/android/app/build.gradle`, for the target SDK check. */
  androidBuildGradle?: string
  /** Whether `.adaptv/ios/App/App/PrivacyInfo.xcprivacy` exists. */
  hasPrivacyManifest?: boolean
  /** Installed dependency names, for the privacy-manifest obligation. */
  dependencies?: readonly string[]
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
    title: "WKAppBoundDomains is set without the Capacitor opt-in",
    detail:
      "WebKit will refuse WKUserScript injection, which is how Capacitor injects its " +
      "native bridge. Capacitor.getPlatform() will return 'web' and EVERY plugin will " +
      "silently fall back to its web implementation — no error, no crash, just an app " +
      "that quietly has no native capabilities.",
    fix:
      "Remove WKAppBoundDomains from .adaptv/ios/App/App/Info.plist. adaptv never adds it, and the " +
      "usual reason for adding it (relaxing ITP's storage cap) does not work — WebKit's " +
      "isAppBoundITPRelaxationEnabled is a constexpr false. If you genuinely need it, also " +
      "set ios.limitsNavigationsToAppBoundDomains: true in adaptv.config.ts.",
  }
}

/**
 * Android 16 / target API 36 — §6.0, deadline **2026-08-31**.
 *
 * API 36 removes the edge-to-edge opt-out entirely, and
 * `setStatusBarColor`/`setNavigationBarColor` become no-ops rather than errors.
 * An app that relies on them keeps compiling and simply stops tinting.
 */
function checkAndroidTargetSdk(input: DoctorInput): Diagnostic | null {
  const gradle = input.androidBuildGradle
  if (!gradle) return null
  const match = gradle.match(/targetSdk(?:Version)?\s*=?\s*(\d+)/)
  const target = match?.[1] ? Number.parseInt(match[1], 10) : null
  if (target === null || target >= 36) return null

  return {
    severity: "warning",
    title: `Android targetSdk is ${target}; Google Play requires 36`,
    detail:
      "Deadline 2026-08-31 (extensions to 11-01). API 36 also removes the edge-to-edge " +
      "opt-out, and setStatusBarColor / setNavigationBarColor become NO-OPS rather than " +
      "errors — an app relying on them keeps compiling and silently stops tinting.",
    fix:
      "Raise targetSdk to 36 and move status-bar tinting to CSS: viewport-fit=cover plus a " +
      "background painted under the inset is the only portable approach left.",
  }
}

//No `viewport-fit=cover` check: Capacitor hard-gates safe-area insets on that
//exact string, but adaptv GENERATES the viewport meta in its app shell, so it
//cannot be wrong. A doctor rule for a value the framework owns would only ever
//fire on a bug in adaptv itself — and it would report it as the user's problem.
//
//The tag being right is not the same as Capacitor SEEING it right, though:
//SystemBars reads it once, from a DOMContentLoaded listener, and losing that race
//costs the app edge-to-edge for the whole process (grey status-bar band, insets
//reported as 0). That failure is invisible to a file-reading doctor — it is a
//runtime ordering fact — so it is fixed at the source instead, by re-probing from
//`capabilities/status-bar.ts` until a pass lands.

/** The privacy manifest — §5.0.1. Fails at submission, not at build. */
function checkPrivacyManifest(input: DoctorInput): Diagnostic | null {
  if (input.hasPrivacyManifest !== false) return null
  //No iOS project, no obligation — a web-only app has nothing to submit. This
  //gate became load-bearing the moment `dependencies` started including adaptv's
  //own bundled plugins (native/plugins.ts): `@capacitor/preferences` is in every
  //app now, so without it this would report a missing manifest to devs who will
  //never build for iOS.
  if (input.iosInfoPlist === undefined) return null
  const deps = input.dependencies ?? []
  const needsOne = deps.some(
    (d) =>
      d === "@capacitor/preferences" ||
      d === "@capacitor/filesystem" ||
      d === "@capacitor/device" ||
      d === "@aparajita/capacitor-secure-storage",
  )
  if (!needsOne) return null

  return {
    severity: "error",
    title: ".adaptv/ios/App/App/PrivacyInfo.xcprivacy is missing",
    detail:
      "Installed plugins touch Apple required-reason APIs. The manifest is not checked at " +
      "build time — App Store Connect rejects the upload with a generic message, days later.",
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
