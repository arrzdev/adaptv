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
 * ## Scope, stated honestly
 *
 * This declares **required-reason APIs**, which are mechanical. It deliberately
 * does NOT declare data collection (`NSPrivacyCollectedDataTypes`) — that depends
 * on what the *app* does with analytics, accounts and telemetry, which adaptv
 * cannot know. A guessed collection declaration is worse than none: it is a false
 * statement to Apple and to the app's users.
 */

/** An Apple required-reason API category and the reason codes adaptv declares. */
export type RequiredReasonApi = {
  category: string
  reasons: string[]
  /** Which dependency creates the obligation. */
  source: string
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
 * The required-reason APIs implied by an installed dependency set.
 *
 * Merges per category, because two plugins can create the same obligation and
 * Apple expects one entry per *category*, not one per plugin — a duplicated
 * category is a malformed manifest.
 */
export function resolveRequiredReasons(
  dependencies: readonly string[],
): RequiredReasonApi[] {
  const byCategory = new Map<string, RequiredReasonApi>()

  for (const dependency of dependencies) {
    for (const api of PLUGIN_REQUIRED_REASONS[dependency] ?? []) {
      const existing = byCategory.get(api.category)
      if (!existing) {
        byCategory.set(api.category, { ...api, reasons: [...api.reasons] })
        continue
      }
      for (const reason of api.reasons) {
        if (!existing.reasons.includes(reason))
          existing.reasons.push(reason)
      }
      existing.source = `${existing.source}, ${api.source}`
    }
  }

  //stable order so the file does not churn between runs and show up as a
  //spurious diff on every `adaptv sync`
  return [...byCategory.values()].sort((a, b) =>
    a.category.localeCompare(b.category),
  )
}

/** Render the `PrivacyInfo.xcprivacy` plist. */
export function renderPrivacyManifest(
  apis: readonly RequiredReasonApi[],
): string {
  const entries = apis
    .map((api) =>
      [
        "\t\t<dict>",
        "\t\t\t<key>NSPrivacyAccessedAPIType</key>",
        `\t\t\t<string>${api.category}</string>`,
        "\t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>",
        "\t\t\t<array>",
        ...api.reasons.map(
          (reason) => `\t\t\t\t<string>${reason}</string>`,
        ),
        "\t\t\t</array>",
        "\t\t</dict>",
      ].join("\n"),
    )
    .join("\n")

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    "<!-- Generated by @arrzdev/adaptv from the installed plugin set. Do not edit. -->",
    "<!-- Required-reason APIs only. Data collection (NSPrivacyCollectedDataTypes) -->",
    "<!-- depends on what YOUR app does and must be declared by you.               -->",
    '<plist version="1.0">',
    "<dict>",
    "\t<key>NSPrivacyTracking</key>",
    //adaptv never adds tracking; an app that does must declare it itself
    "\t<false/>",
    "\t<key>NSPrivacyTrackingDomains</key>",
    "\t<array/>",
    "\t<key>NSPrivacyCollectedDataTypes</key>",
    "\t<array/>",
    "\t<key>NSPrivacyAccessedAPITypes</key>",
    entries.length > 0
      ? `\t<array>\n${entries}\n\t</array>`
      : "\t<array/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n")
}
