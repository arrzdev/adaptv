/**
 * The Android SDK levels adaptv ships — the ONE place the numbers live.
 *
 * adaptv owns the Android project under `.adaptv/android`, so its compile and
 * target levels are values adaptv writes, not values the dev tunes. They used to
 * be nobody's: nothing in adaptv set them, the project inherited whatever the
 * scaffold template carried, and a template bump or a requirement bump would
 * have reached a new project and never an existing one (the project is
 * scaffolded once and then persists). `doctor` warned about the value it could
 * not read, from a file that never carries it (`app/build.gradle` only
 * references `rootProject.ext.targetSdkVersion`), so the warning was dead too.
 *
 * Why 36 — Android 16, and the level Google Play requires since 2026-08-31
 * (extensions ran to 2026-11-01): the edge-to-edge opt-out is removed, and
 * `setStatusBarColor` / `setNavigationBarColor` become silent no-ops rather
 * than errors, so an app that relies on them keeps compiling and simply stops
 * tinting. adaptv paints the chrome from CSS already (`capabilities/theme-color.ts`),
 * which is why the bump is a number and not an architecture change.
 * → `docs/decisions/register.md` B9 (§6.0)
 */
export const ANDROID_SDK_LEVELS = { compile: 36, target: 36 } as const

/** The keys, exactly as the scaffold writes them into `variables.gradle`'s `ext { }`. */
const KEYS = {
  compileSdkVersion: ANDROID_SDK_LEVELS.compile,
  targetSdkVersion: ANDROID_SDK_LEVELS.target,
} as const

/** `key = N` — the scaffold's shape; whitespace around `=` is the file's own. */
const levelLine = (key: string) => new RegExp(`(\\b${key}\\s*=\\s*)(\\d+)`)

/**
 * `variables.gradle` with every level adaptv owns raised to what it ships.
 *
 * Only ever RAISES: a level already at or above stays, and so does everything
 * else in the file, byte for byte — the caller writes through an up-to-date
 * check that the native build's own caching leans on, so an unchanged file must
 * come back as the same string. A file without the keys is a shape this does not
 * know and is returned untouched: inventing lines into someone else's `ext { }`
 * is how a project stops building with no line in the diff to blame.
 */
export function stampAndroidSdkLevels(variablesGradle: string): string {
  let out = variablesGradle
  for (const [key, required] of Object.entries(KEYS)) {
    out = out.replace(
      levelLine(key),
      (whole, lhs: string, digits: string) =>
        Number.parseInt(digits, 10) < required
          ? `${lhs}${required}`
          : whole,
    )
  }
  return out
}

/**
 * The target level `variables.gradle` carries, or `null` when the file does not
 * say — which is what `app/build.gradle` always answers, because it names the
 * variable and never the number.
 */
export function readAndroidTargetSdk(
  variablesGradle: string,
): number | null {
  const match = variablesGradle.match(levelLine("targetSdkVersion"))
  return match?.[2] ? Number.parseInt(match[2], 10) : null
}
