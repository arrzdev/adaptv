/**
 * The Capacitor plugins adaptv ships as **its own** dependencies.
 *
 * The consumer installs none of these — they are resolved from the framework and
 * linked into every native build, so they never appear in the app's
 * `package.json`. That is the whole point (`DECISIONS.md` L20: the consumer does
 * not know adaptv runs on Capacitor), and it is also a trap: anything that asks
 * "what does this app depend on?" by reading the app's manifest gets an answer
 * that is missing every plugin the binary actually links.
 *
 * Which is exactly what happened to the privacy manifest. `resolveRequiredReasons`
 * scanned the app's dependencies, never saw `@capacitor/preferences`, and wrote
 * `NSPrivacyAccessedAPITypes` as an empty array into an `.ipa` whose
 * `Frameworks/` directory contains `CapacitorPreferences.framework` — a binary
 * that reaches `UserDefaults`, declaring no reason for it. `adaptv doctor`'s
 * missing-manifest rule was keyed off the same list and could never fire either.
 * An empty declaration is not a safe default here: it is a false statement to
 * Apple, which is the one thing `privacy-manifest.ts` set out not to make.
 *
 * So it lives here, in framework source, and both the CLI (`doctor`) and
 * `stamp-privacy.ts` read this one copy. → `DECISIONS.md §5.0.1`
 */
export const ADAPTV_BUNDLED_PLUGINS = [
  "@capacitor/app",
  "@capacitor/browser",
  "@capacitor/core",
  "@capacitor/geolocation",
  "@capacitor/haptics",
  "@capacitor/keyboard",
  "@capacitor/network",
  "@capacitor/preferences",
  "@capacitor/screen-orientation",
  "@capacitor/splash-screen",
  "@capacitor/status-bar",
] as const

/**
 * Everything linked into a native build: adaptv's bundled plugins plus whatever
 * the app itself declares. Deduplicated, because a consumer is free to install a
 * plugin adaptv already ships and a doubled name would double its obligations.
 */
export function linkedDependencies(
  appDependencies: readonly string[],
): string[] {
  return [...new Set([...ADAPTV_BUNDLED_PLUGINS, ...appDependencies])]
}
