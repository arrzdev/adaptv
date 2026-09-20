/**
 * The values in `adaptv.config.ts` that cannot produce the app that was asked
 * for — each a finished sentence naming the key, the shape, and what was there.
 *
 * `adaptv.config.ts` is bundled and evaluated as data, so nothing type-checks
 * it before it is read: a key the type marks required can be missing, and a
 * union can hold any string. Without this check those values fail deep inside
 * whichever consumer touches them first, which is either a `TypeError` naming
 * no key (`styles` missing → `Cannot read properties of undefined (reading
 * 'replace')`) or, worse, nothing at all — `orientation: "sideways"` shipped
 * into the manifest, `render: "static"` silently treated as SSR. Guessing is
 * the bug; saying so is the fix.
 *
 * Only values the build consumes and gets wrong are checked. Keys that are
 * merely optional, or whose wrong value is inert, are not — a sentence about a
 * key that would have worked anyway is noise (`docs/design/cli-contract.md` R4).
 *
 * The CLI's preflight (`bin/lib/preflight.mjs`) asks this same function before
 * a run starts, so the CLI and the build refuse the same configs with the same
 * sentences — one definition of "usable", not two that agree today.
 */

/** `#rgb` / `#rrggbb` — the shape `parseHex` accepts and the native colour resources need. */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * A Capacitor `appId` is also the Android package and the iOS bundle id: at
 * least two dot-separated segments, each starting with a letter.
 */
const APP_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/

/**
 * A URL scheme as the native projects declare it: RFC 3986's letter-then-letters,
 * digits, `+`, `-` or `.`, lowercase only. Schemes compare case-insensitively, but
 * Android's intent filter matches `android:scheme` case-sensitively — an uppercase
 * scheme is declared and then never matched there.
 */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*$/

/**
 * Schemes that already mean something to every app: a web link, or the WebView's own
 * pages. Declaring one would either be ignored by the OS or take links meant for the
 * browser.
 */
const RESERVED_SCHEMES = new Set([
  "http",
  "https",
  "file",
  "about",
  "data",
  "blob",
  "javascript",
  "capacitor",
])

type Raw = Record<string, unknown>

const isObject = (value: unknown): value is Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const show = (value: unknown): string =>
  value === undefined ? "undefined" : JSON.stringify(value)

/** `a, b or c` — the list as a sentence reads it. */
const oneOf = (values: readonly string[]): string =>
  values.length < 2
    ? values.join("")
    : `${values.slice(0, -1).join(", ")} or ${values.at(-1)}`

/** The colour-valued keys, as the dev wrote them in `adaptv.config.ts`. */
function colorKeys(config: Raw): Array<[string, unknown]> {
  const theme = isObject(config.themeColor) ? config.themeColor : {}
  return [
    ["themeColor.light", theme.light],
    ["themeColor.dark", theme.dark],
    ["backgroundColor", config.backgroundColor],
    ["splashMaskLightColor", config.splashMaskLightColor],
    ["splashMaskDarkColor", config.splashMaskDarkColor],
  ]
}

/**
 * `deepLinks` is written into `Info.plist` and `AndroidManifest.xml` verbatim, and a
 * wrong scheme builds green on both: the app installs, and the link opens nothing.
 */
function deepLinkErrors(value: unknown): string[] {
  if (value === undefined) return []
  if (!isObject(value))
    return [
      `'deepLinks' must be an object like { scheme: "myapp" }, got ${show(value)}`,
    ]
  const scheme = value.scheme
  if (typeof scheme !== "string" || !URL_SCHEME.test(scheme))
    return [
      `'deepLinks.scheme' must be a lowercase URL scheme like myapp (a letter, then letters, digits, '+', '-' or '.'), got ${show(scheme)}`,
    ]
  if (RESERVED_SCHEMES.has(scheme))
    return [
      `'deepLinks.scheme' can't be ${show(scheme)}: that scheme is reserved`,
    ]
  return []
}

/** The keys whose value is one of a closed set, and what the set is. */
const ENUMS: ReadonlyArray<[string, readonly string[]]> = [
  ["orientation", ["portrait", "landscape", "any"]],
  ["render", ["ssr", "spa"]],
  ["serviceWorkerUpdate", ["auto", "prompt"]],
  ["defaultThemePreference", ["light", "dark", "system"]],
  ["splashMaskMode", ["preferences", "system", "light", "dark"]],
  ["otaOnNativeSkew", ["install", "refuse"]],
]

/** The keys that must be a plain number when present. */
const NUMBERS: ReadonlyArray<[string, string]> = [
  ["otaPollMinutes", "a number of minutes"],
  ["updateRequiredAfterDays", "a number of days"],
]

/** The keys that must be a list of strings when present. */
const STRING_LISTS: ReadonlyArray<[string, string]> = [
  ["plugins", "a list of package names"],
  ["serviceWorkers", "a list of file paths"],
]

/**
 * Every problem in the config, as one sentence each. Empty when the config
 * can be built. Pure: reads the object, touches nothing else.
 */
export function appConfigErrors(config: unknown): string[] {
  if (!isObject(config)) return ["the config must be an object"]
  const errors: string[] = []

  //the required keys the build reads unconditionally — each crashes or ships
  //a hole when missing (`name` → a manifest and a `<title>` with no name;
  //`styles` → a TypeError in the root-route module; `router` → one in the
  //plugin factory)
  if (typeof config.name !== "string" || config.name.trim() === "")
    errors.push(`'name' must be the app's name, got ${show(config.name)}`)
  if (typeof config.styles !== "string" || config.styles.trim() === "")
    errors.push(
      `'styles' must be a path to the app's stylesheet, got ${show(config.styles)}`,
    )
  if (!isObject(config.router))
    errors.push(`'router' must be an object, got ${show(config.router)}`)
  else if (
    config.router.routesDirectory !== undefined &&
    typeof config.router.routesDirectory !== "string"
  )
    //resolved with `path.resolve`, which throws a TypeError naming `paths[2]`
    errors.push(
      `'router.routesDirectory' must be a path to the routes directory, got ${show(config.router.routesDirectory)}`,
    )

  if (config.appId !== undefined && !APP_ID.test(String(config.appId)))
    errors.push(
      `'appId' must be reverse-DNS like com.example.app, got ${show(config.appId)}`,
    )

  errors.push(...deepLinkErrors(config.deepLinks))

  const theme = isObject(config.themeColor) ? config.themeColor : null
  if (!theme?.light && !theme?.dark)
    errors.push("'themeColor' needs at least one of 'light' / 'dark'")
  for (const [key, value] of colorKeys(config)) {
    if (value === undefined) continue
    if (typeof value !== "string" || !HEX.test(value.trim()))
      errors.push(
        `'${key}' must be a hex colour like #1b1b1b, got ${show(value)}`,
      )
  }

  for (const [key, values] of ENUMS) {
    const value = config[key]
    if (value === undefined) continue
    if (typeof value !== "string" || !values.includes(value))
      errors.push(`'${key}' must be ${oneOf(values)}, got ${show(value)}`)
  }

  if (config.icons !== undefined && typeof config.icons !== "string")
    errors.push(
      `'icons' must be a path to the app's icon directory, got ${show(config.icons)}`,
    )

  for (const [key, shape] of NUMBERS) {
    const value = config[key]
    if (value === undefined) continue
    if (typeof value !== "number" || !Number.isFinite(value))
      errors.push(`'${key}' must be ${shape}, got ${show(value)}`)
  }

  for (const [key, shape] of STRING_LISTS) {
    const value = config[key]
    if (value === undefined) continue
    if (
      !Array.isArray(value) ||
      !value.every((entry) => typeof entry === "string")
    )
      errors.push(`'${key}' must be ${shape}, got ${show(value)}`)
  }

  return errors
}
