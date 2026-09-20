import { useSyncExternalStore } from "react"
import type { LocaleInfo } from "#adaptv/capabilities/locale"
import {
  getLocale,
  resolveLocale,
  subscribeLocale,
} from "#adaptv/capabilities/locale"

//the server has no user to ask, so it renders the bare fallback — one object,
//built once, so a hydrating tree compares against the same reference every time.
//The zone is pinned rather than read: this module is evaluated once on the server
//and again in the browser, and `resolveLocale` reads each runtime's own zone, so
//a server in UTC and a user in Lisbon would hydrate two different strings from
//the "same" snapshot and React would throw the server's tree away
const SERVER_LOCALE: LocaleInfo = {
  ...resolveLocale("en"),
  timeZone: "UTC",
}
const getServerLocale = () => SERVER_LOCALE

/**
 * The current locale, as a hook. Re-renders when the tag or the preference list
 * changes and not otherwise; the record is the same object between changes.
 *
 * Pass `languageTag` to every `Intl` call and `toLocale*` method you make — the
 * engine's default locale is frozen at process start and does NOT follow a
 * language change (see the capability's header for the measurement), so a call
 * without the tag renders the boot language for the rest of the process.
 */
export function useLocale(): LocaleInfo {
  return useSyncExternalStore(subscribeLocale, getLocale, getServerLocale)
}
