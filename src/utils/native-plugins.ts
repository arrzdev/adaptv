//INTERNAL. Deliberately absent from `interface/utils.index.ts`, and it stays
//that way: adaptv ships no public "can I call this plugin?" API. A framework
//whose value is that the developer never has to know the problem exists cannot
//also hand him an API for asking. What the app sees is the ordinary
//`useShare().supported` it already reads — this is only where that answer comes
//from once OTA is in play. → `LIFECYCLE.md §5.6`

/**
 * Whether the **installed binary** carries this plugin's native code.
 *
 * ## Why this exists at all
 *
 * Everywhere else, "am I native?" is the whole question, because the bundle and
 * the binary shipped together through the store. OTA breaks that: a bundle built
 * after a release that added `@capacitor/share` lands on every install the day
 * it is published, including the ones whose binary predates the plugin. Under
 * the `"install"` default that bundle is *supposed* to run — the rest of the
 * release is worth having — so the parts that need the missing native code have
 * to report themselves unavailable instead of rejecting at the call.
 *
 * `Capacitor.PluginHeaders` is the one thing on the device that describes the
 * **binary** rather than the bundle: the native layer injects it before any app
 * JS runs, one entry per plugin actually compiled in. Nothing a bundle can carry
 * changes it, which is exactly the property the answer needs.
 *
 * ## 🔴 Not `Capacitor.isPluginAvailable()`
 *
 * That one answers "is there an implementation registered for this platform",
 * and a JS implementation counts. Today it happens to reduce to the header check
 * on native — every `@capacitor/*` package registers its fallback under `"web"`
 * only — but that is a coincidence of how those packages are written, not a
 * contract. One plugin registering an `"ios"` JS shim would make it answer `true`
 * on a binary with no native code for it, and the failure would be a rejected
 * bridge call on a user's device rather than a hidden button.
 *
 * The question here is narrower and permanent: *is the native code in this
 * binary*. That is the header, read directly.
 *
 * Read off the global rather than through `@capacitor/core`, for the same reason
 * `platform.ts` does: a pure web build must need nothing installed.
 *
 * @param name the plugin's registered name — `"Share"`, not `"@capacitor/share"`
 */
export function hasNativePlugin(name: string): boolean {
  if (typeof window === "undefined") return false
  const headers = (
    globalThis as {
      Capacitor?: { PluginHeaders?: Array<{ name?: string }> }
    }
  ).Capacitor?.PluginHeaders
  //Absent headers are not evidence of absence — they mean this runtime told us
  //nothing. Answering `false` there would hide a working feature for good, so
  //fall back to the behaviour every non-OTA app has always had: assume present,
  //and let the call fail if it isn't. The one runtime this can reach is a native
  //shell whose bridge did not inject the list at all.
  if (!headers) return true
  return headers.some((header) => header.name === name)
}
