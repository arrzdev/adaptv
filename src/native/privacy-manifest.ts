/**
 * `PrivacyInfo.xcprivacy` generation. → `DECISIONS.md §5.0.1`
 *
 * ## Why this is adaptv's job
 *
 * Apple requires a privacy manifest declaring every "required reason API" an app
 * touches. **Not one of the 22 official Capacitor plugins ships one** — verified
 * by grepping the whole `ionic-team/capacitor-plugins` tree — while Capacitor
 * itself is on Apple's commonly-used-third-party-SDK list. `@capacitor/preferences`
 * is explicit that the obligation lands on the app: *"you must create a
 * `PrivacyInfo.xcprivacy` file in `/ios/App`… the required dictionary key is
 * `NSPrivacyAccessedAPICategoryUserDefaults` and the recommended reason is
 * `CA92.1`."*
 *
 * So the requirement is (a) real, (b) **derivable from the dependency list**,
 * (c) currently satisfied by hand-editing XML, and (d) **fails silently at
 * submission** — App Store Connect rejects the upload with a generic message,
 * days after the code was written and far from anything that explains it.
 *
 * Anything derivable from config should be derived. Same principle as the
 * generated root route, router and service worker.
 *
 * ## Where the declarations come from — three tiers, in this order
 *
 * 1. **adaptv's table** ({@link PLUGIN_REQUIRED_REASONS}) — Apple policy for the
 *    plugins adaptv itself ships, plus the common community ones. This tier is
 *    the one that must never depend on the app naming anything: `@capacitor/device`
 *    and `@capacitor/preferences` are compiled into EVERY native adaptv app, so
 *    their obligations are the app's obligations whether it knows it or not.
 * 2. **The plugin's own `PrivacyInfo.xcprivacy`** ({@link parseShippedPrivacyManifest})
 *    — Apple's actual mechanism for third-party SDKs. None of the 22 official
 *    Capacitor plugins ships one today, but community plugins increasingly do, and
 *    a plugin's own declaration is more authoritative than adaptv's table.
 * 3. **The app's own declaration** ({@link AdaptvPrivacyConfig}) — the escape hatch
 *    for a plugin neither tier covers, and the only way to say anything about what
 *    the APP does, since the manifest is generated and must not be hand-edited.
 *
 * ## Scope, stated honestly
 *
 * Required-reason APIs are mechanical and adaptv derives them. Data collection
 * (`NSPrivacyCollectedDataTypes`) is not: it depends on what the *app* does with
 * analytics, accounts and telemetry, which adaptv cannot know. adaptv therefore
 * never guesses it — a guessed collection declaration is worse than none, it is a
 * false statement to Apple and to the app's users — but the app can declare it
 * through {@link AdaptvPrivacyConfig}, which is the only place it can, because
 * this file is regenerated on every build.
 */

/** An Apple required-reason API category and the reason codes adaptv declares. */
export type RequiredReasonApi = {
  category: string
  reasons: string[]
  /** Which dependency creates the obligation. */
  source: string
}

/** One `NSPrivacyCollectedDataTypes` entry — what the app collects, and why. */
export type CollectedDataType = {
  /** Apple's data-type constant, e.g. `"NSPrivacyCollectedDataTypeEmailAddress"`. */
  type: string
  /** Is it tied to the user's identity? (`NSPrivacyCollectedDataTypeLinked`) */
  linked: boolean
  /** Is it used to track across apps? (`NSPrivacyCollectedDataTypeTracking`) */
  tracking: boolean
  /** Apple's purpose constants, e.g. `["NSPrivacyCollectedDataTypePurposeAppFunctionality"]`. */
  purposes: string[]
}

/**
 * What the app declares about itself in `PrivacyInfo.xcprivacy`, on top of what
 * adaptv derives from the installed plugins.
 *
 * Everything here is optional and additive. Leaving it out is the honest default
 * for an app that neither tracks nor collects: adaptv already writes the plugin
 * obligations, `NSPrivacyTracking` false, and empty collection/tracking-domain
 * arrays.
 */
export type AdaptvPrivacyConfig = {
  /**
   * Required-reason APIs adaptv cannot derive: a plugin missing from its table, or
   * an API the app's own native code touches. Keyed by Apple's category, valued by
   * its reason codes. Merged with the derived set — declaring a category adaptv
   * already found adds your reasons to it rather than replacing them.
   *
   * @example requiredReasonAPIs: { NSPrivacyAccessedAPICategoryFileTimestamp: ["C617.1"] }
   */
  requiredReasonAPIs?: Record<string, string[]>
  /**
   * `NSPrivacyTracking` — does the app track users as Apple defines it (linking
   * data to third-party data for advertising or measurement)? Default `false`.
   */
  tracking?: boolean
  /**
   * `NSPrivacyTrackingDomains` — the domains the app connects to for tracking.
   * Apple blocks these at runtime unless the user grants ATT permission.
   */
  trackingDomains?: string[]
  /**
   * `NSPrivacyCollectedDataTypes` — what the app collects about its users. adaptv
   * never infers this; an app with analytics, accounts or telemetry has to say so
   * here, and an app with none leaves it out.
   */
  collectedData?: CollectedDataType[]
}

/**
 * Map an installed plugin to the required-reason APIs it touches.
 *
 * Deliberately a small explicit table rather than static analysis: this mapping
 * is **Apple policy, not code structure**. It changes when Apple changes the
 * rules, not when the plugin changes — so a table a human can read and correct
 * beats anything inferred from the source.
 */
const PLUGIN_REQUIRED_REASONS: Record<string, RequiredReasonApi[]> = {
  "@capacitor/preferences": [
    {
      //UserDefaults. CA92.1 = access info from the app itself / its app group
      category: "NSPrivacyAccessedAPICategoryUserDefaults",
      reasons: ["CA92.1"],
      source: "@capacitor/preferences",
    },
  ],
  "@capacitor/filesystem": [
    {
      //C617.1 = timestamps for files inside the app's own container
      category: "NSPrivacyAccessedAPICategoryFileTimestamp",
      reasons: ["C617.1"],
      source: "@capacitor/filesystem",
    },
    {
      //E174.1 = disk space, to avoid attempting a write that would fail
      category: "NSPrivacyAccessedAPICategoryDiskSpace",
      reasons: ["E174.1"],
      source: "@capacitor/filesystem",
    },
  ],
  "@aparajita/capacitor-secure-storage": [
    {
      category: "NSPrivacyAccessedAPICategoryUserDefaults",
      reasons: ["CA92.1"],
      source: "@aparajita/capacitor-secure-storage",
    },
  ],
  "@capacitor/device": [
    {
      //35F9.1 = system boot time, for measuring elapsed time within the app
      category: "NSPrivacyAccessedAPICategorySystemBootTime",
      reasons: ["35F9.1"],
      source: "@capacitor/device",
    },
  ],
}

/**
 * The required-reason APIs implied by an installed plugin set, plus any the caller
 * already knows about — a plugin's own shipped manifest (tier 2) and the app's
 * declaration (tier 3) both arrive here as `declared`.
 *
 * Merges per category, because two plugins can create the same obligation and
 * Apple expects one entry per *category*, not one per plugin — a duplicated
 * category is a malformed manifest.
 */
export function resolveRequiredReasons(
  packages: readonly string[],
  declared: readonly RequiredReasonApi[] = [],
): RequiredReasonApi[] {
  const byCategory = new Map<string, RequiredReasonApi>()

  const add = (api: RequiredReasonApi) => {
    const existing = byCategory.get(api.category)
    if (!existing) {
      byCategory.set(api.category, { ...api, reasons: [...api.reasons] })
      return
    }
    for (const reason of api.reasons) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason)
    }
    //one source per contributor, so a reader can tell WHY a category is declared
    if (!existing.source.split(", ").includes(api.source))
      existing.source = `${existing.source}, ${api.source}`
  }

  for (const pkg of packages)
    for (const api of PLUGIN_REQUIRED_REASONS[pkg] ?? []) add(api)
  for (const api of declared) add(api)

  //stable order so the file does not churn between runs and show up as a
  //spurious diff on every `adaptv sync`
  return [...byCategory.values()].sort((a, b) =>
    a.category.localeCompare(b.category),
  )
}

/**
 * The required-reason APIs a plugin declares in its OWN `PrivacyInfo.xcprivacy`
 * — tier 2, and the only tier that stays correct without adaptv shipping a new
 * version of its table.
 *
 * Deliberately a scoped regex read and not a plist parser: the only thing wanted
 * is `NSPrivacyAccessedAPIType` entries, whose dicts never nest, and a dependency
 * that can parse arbitrary plists would be a large surface for a small question.
 * Anything unreadable — a binary plist, a malformed file, a truncated one — yields
 * NOTHING rather than throwing: the table and the app's own declaration still
 * apply, and a plugin's manifest is a bonus, never the thing being relied on.
 */
export function parseShippedPrivacyManifest(
  xml: string,
  source: string,
): RequiredReasonApi[] {
  const out: RequiredReasonApi[] = []
  //match every dict and keep the ones carrying an accessed-API type: that key
  //appears nowhere else in the format, so no array-boundary tracking is needed
  for (const dict of xml.match(/<dict>[\s\S]*?<\/dict>/g) ?? []) {
    const category = dict.match(
      /<key>NSPrivacyAccessedAPIType<\/key>\s*<string>([^<]+)<\/string>/,
    )?.[1]
    if (!category) continue
    const block = dict.match(
      /<key>NSPrivacyAccessedAPITypeReasons<\/key>\s*<array>([\s\S]*?)<\/array>/,
    )?.[1]
    const reasons = [
      ...(block ?? "").matchAll(/<string>([^<]+)<\/string>/g),
    ].map((m) => m[1] as string)
    //a category with no reason is not a declaration Apple accepts, and guessing
    //one would be adaptv putting words in the plugin's mouth
    if (reasons.length === 0) continue
    out.push({ category: category.trim(), reasons, source })
  }
  return out
}

/** The app's own `requiredReasonAPIs` (tier 3), in the shape the merge expects. */
export function declaredRequiredReasons(
  privacy: AdaptvPrivacyConfig | undefined,
): RequiredReasonApi[] {
  return Object.entries(privacy?.requiredReasonAPIs ?? {})
    .filter(([, reasons]) => reasons.length > 0)
    .map(([category, reasons]) => ({
      category,
      reasons: [...reasons],
      source: "adaptv.config.ts",
    }))
}

/** Values now reach this from `adaptv.config.ts`, so they are no longer adaptv's own strings. */
const esc = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** `<array>` of strings at the given tab depth, self-closing when empty. */
function stringArray(values: readonly string[], depth: number): string {
  const pad = "\t".repeat(depth)
  if (values.length === 0) return `${pad}<array/>`
  return [
    `${pad}<array>`,
    ...values.map((v) => `${pad}\t<string>${esc(v)}</string>`),
    `${pad}</array>`,
  ].join("\n")
}

/**
 * Render the `PrivacyInfo.xcprivacy` plist.
 *
 * `privacy` is the app's own declaration ({@link AdaptvPrivacyConfig}); omitted, the
 * file says what it has always said — no tracking, no collection, plugin obligations
 * only.
 */
export function renderPrivacyManifest(
  apis: readonly RequiredReasonApi[],
  privacy?: AdaptvPrivacyConfig,
): string {
  const entries = apis
    .map((api) =>
      [
        "\t\t<dict>",
        "\t\t\t<key>NSPrivacyAccessedAPIType</key>",
        `\t\t\t<string>${esc(api.category)}</string>`,
        "\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>",
        stringArray(api.reasons, 3),
        "\t\t</dict>",
      ].join("\n"),
    )
    .join("\n")

  const collected = (privacy?.collectedData ?? [])
    .map((data) =>
      [
        "\t\t<dict>",
        "\t\t\t<key>NSPrivacyCollectedDataType</key>",
        `\t\t\t<string>${esc(data.type)}</string>`,
        "\t\t\t<key>NSPrivacyCollectedDataTypeLinked</key>",
        `\t\t\t<${data.linked}/>`,
        "\t\t\t<key>NSPrivacyCollectedDataTypeTracking</key>",
        `\t\t\t<${data.tracking}/>`,
        "\t\t\t<key>NSPrivacyCollectedDataTypePurposes</key>",
        stringArray(data.purposes, 3),
        "\t\t</dict>",
      ].join("\n"),
    )
    .join("\n")

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    "<!-- Generated by @arrzdev/adaptv from the installed plugin set. Do not edit: -->",
    "<!-- it is rewritten on every build. Anything adaptv cannot derive — tracking, -->",
    "<!-- collected data, an unlisted plugin's APIs — goes in `privacy` in          -->",
    "<!-- adaptv.config.ts, and is rendered here from there.                        -->",
    '<plist version="1.0">',
    "<dict>",
    "\t<key>NSPrivacyTracking</key>",
    //adaptv never adds tracking; an app that does declares it in `privacy.tracking`
    `\t<${privacy?.tracking === true}/>`,
    "\t<key>NSPrivacyTrackingDomains</key>",
    stringArray(privacy?.trackingDomains ?? [], 1),
    "\t<key>NSPrivacyCollectedDataTypes</key>",
    collected.length > 0
      ? `\t<array>\n${collected}\n\t</array>`
      : "\t<array/>",
    "\t<key>NSPrivacyAccessedAPITypes</key>",
    entries.length > 0
      ? `\t<array>\n${entries}\n\t</array>`
      : "\t<array/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n")
}
