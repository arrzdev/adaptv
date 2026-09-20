//Locale accessor — which language the user asked for, and what that language
//implies for rendering: text direction, hour cycle, week shape, number
//separators, time zone, calendar. ONE implementation for all six targets, built
//on `Intl` alone: no plugin, no locale table, no dependency.
//
//## Why this is a function, not a constant
//
//`docs/research/capability-surface.md` §3.4: constants for what cannot change
//during the process lifetime, functions for what can. The language CAN change —
//the user opens Settings, picks another one and comes back — so {@link getLocale}
//is a call that re-reads, and {@link subscribeLocale} says when to re-read.
//
//## Measured 2026-09-02 — Pixel 10 emulator (API 37), Android System WebView
//## Chrome/149, an adaptv-built APK read over CDP, the language changed per app
//## with `cmd locale set-app-locales`
//
//  • The tag follows the OS, in the same process: `navigator.language` went
//    en-US → pt-PT → ar-EG, `navigator.languages` read [pt-PT, en-US], and the
//    native device plugin's language tag agreed each time.
//  • BUT the engine's DEFAULT locale is frozen at process start.
//    `Intl.DateTimeFormat().resolvedOptions().locale` stayed en-US throughout,
//    and `toLocaleTimeString(undefined, …)` still printed "3:07 PM" while
//    `toLocaleTimeString("pt-PT", …)` printed "15:07" and
//    `new Intl.NumberFormat("pt-PT").format(1234.5)` printed "1234,5". **This is
//    the reason the capability exists**: every `Intl` call below is given the
//    tag explicitly, and nothing here ever trusts the default locale. An app
//    that calls `toLocaleString()` with no tag renders the boot language until
//    the OS kills the process, whatever Settings says.
//  • A per-app language change on Android native RELOADS the WebView document
//    in place: a `languagechange` listener armed before the change was gone
//    after it, `performance.timeOrigin` moved (1788336295960 → 1788336342316)
//    while the process pid stayed 7923 — and the default `Intl` locale was STILL
//    en-US after that reload while `navigator.language` read pt-PT (the frozen
//    default is per process, and the process survived). So on Android native the
//    record is simply correct at boot and `languagechange` never fires for the
//    app. The subscription is for the browser tab and the installed PWA, where a
//    browser-level language change is a live event — and possibly iOS.
//  • `new Intl.Locale("pt-PT").getHourCycles()` → ["h23"], en-US → ["h12"];
//    `getTextInfo()` for ar-EG → direction rtl; `getWeekInfo()` en-US firstDay 7
//    weekend [6,7], ar-EG firstDay 6 weekend [5,6].
//  • iOS: measured separately, see the PR.
//
//## Which `Intl` answers, and what happens when one is missing
//
//The direction, hour cycle and week shape come from the Intl Locale Info
//functions (`getTextInfo` / `getHourCycles` / `getWeekInfo`, with the older
//getter spellings accepted). Where an engine has none of them the record is
//still filled — direction from a short RTL script/language list, the hour cycle
//from `DateTimeFormat.resolvedOptions()`, the week from the ISO default — and
//`locale.test.ts` exercises each fallback by deleting the function it stands in
//for, so the fallback is a tested path rather than a hoped-for one.
import { onResume } from "#adaptv/capabilities/app-state"

/**
 * One record, every field always filled: the caller renders it, never probes
 * it. The `Intl` machinery answers for every tag it can parse, and a tag it
 * cannot parse resolves as `"en"` — a bare fallback is more useful to a
 * formatter than a thrown error.
 */
export type LocaleInfo = {
  /** BCP-47 tag, canonicalised — `"pt-PT"`, `"zh-Hant-TW"`. */
  languageTag: string
  /** `"pt"` — the language subtag alone. */
  language: string
  /** `"Hant"` when the tag carries a script; `null` when it does not. */
  script: string | null
  /** `"PT"` — `null` for a bare `"de"`. */
  region: string | null
  /** Text direction the language is written in. */
  direction: "ltr" | "rtl"
  /** `"h12"` for a 3:07 PM culture, `"h23"` for a 15:07 one. */
  hourCycle: "h12" | "h23"
  /** First day of the week — 1 = Monday … 7 = Sunday. */
  firstWeekday: number
  /** The weekend, in the same 1–7 numbering — `[6, 7]` for most of the world. */
  weekend: number[]
  /** `"."` or `","` — what separates 1 from ½. */
  decimalSeparator: string
  /** `","`, `"."` or a space — what groups the thousands. */
  groupingSeparator: string
  /** IANA zone, `"Europe/Lisbon"`; `"UTC"` when the runtime will not say. */
  timeZone: string
  /** `"gregory"`, `"buddhist"`, `"persian"` — the calendar the tag defaults to. */
  calendar: string
  /** The user's ranked preferences (`navigator.languages`), or just the tag. */
  preferred: string[]
}

/**
 * The Intl Locale Info functions, which `lib.dom`/`lib.es2022` do not declare
 * yet. Every member is optional because every member is genuinely optional at
 * runtime — see the header — and both the function and the getter spelling of
 * each are read, because the proposal changed shape mid-flight.
 */
type LocaleInfoApi = Intl.Locale & {
  getTextInfo?: () => { direction?: string }
  textInfo?: { direction?: string }
  getHourCycles?: () => string[]
  hourCycles?: string[]
  getWeekInfo?: () => { firstDay?: number; weekend?: number[] }
  weekInfo?: { firstDay?: number; weekend?: number[] }
}

/** The fallback for direction when the engine has no `getTextInfo` — language subtags. */
const RTL_LANGUAGES = new Set([
  "ar",
  "he",
  "fa",
  "ur",
  "yi",
  "ps",
  "sd",
  "ug",
  "ku",
  "dv",
])
/** …and scripts, which win over the language when the tag names one (`az-Arab`). */
const RTL_SCRIPTS = new Set([
  "Arab",
  "Hebr",
  "Thaa",
  "Syrc",
  "Nkoo",
  "Adlm",
])

const FALLBACK_TAG = "en"

/**
 * `tag` canonicalised and parsed, or the `"en"` fallback when `Intl` refuses
 * it — one place decides, so the tag in the record and the locale the fields
 * are read from can never disagree.
 */
function parseTag(tag: string): {
  languageTag: string
  locale: LocaleInfoApi
} {
  try {
    const [canonical] = Intl.getCanonicalLocales(tag)
    if (canonical) {
      return { languageTag: canonical, locale: new Intl.Locale(canonical) }
    }
  } catch {
    //RangeError — not a BCP-47 tag; nothing to salvage from it
  }
  return {
    languageTag: FALLBACK_TAG,
    locale: new Intl.Locale(FALLBACK_TAG),
  }
}

function directionOf(locale: LocaleInfoApi): "ltr" | "rtl" {
  let direction: string | undefined
  try {
    direction =
      typeof locale.getTextInfo === "function"
        ? locale.getTextInfo().direction
        : locale.textInfo?.direction
  } catch {
    //an engine that has the function but refuses the tag — same as not having it
  }
  if (direction === "rtl" || direction === "ltr") return direction
  if (locale.script) return RTL_SCRIPTS.has(locale.script) ? "rtl" : "ltr"
  return RTL_LANGUAGES.has(locale.language) ? "rtl" : "ltr"
}

function hourCycleOf(locale: LocaleInfoApi, tag: string): "h12" | "h23" {
  let cycle: string | undefined
  try {
    const cycles =
      typeof locale.getHourCycles === "function"
        ? locale.getHourCycles()
        : locale.hourCycles
    cycle = cycles?.[0]
  } catch {
    //fall through to the formatter, which every engine has
  }
  if (!cycle) {
    try {
      cycle = new Intl.DateTimeFormat(tag, {
        hour: "numeric",
      }).resolvedOptions().hourCycle
    } catch {
      //an unformattable tag — the record still needs an answer
    }
  }
  //the proposal has four cycles; a clock face has two. h11 (0–11) is a 12-hour
  //clock with a midnight quirk, h24 (1–24) a 24-hour one — collapse each to its face
  return cycle === "h12" || cycle === "h11" ? "h12" : "h23"
}

function isWeekday(day: unknown): day is number {
  return (
    Number.isInteger(day) && (day as number) >= 1 && (day as number) <= 7
  )
}

function weekOf(locale: LocaleInfoApi): {
  firstWeekday: number
  weekend: number[]
} {
  let info: { firstDay?: number; weekend?: number[] } | undefined
  try {
    info =
      typeof locale.getWeekInfo === "function"
        ? locale.getWeekInfo()
        : locale.weekInfo
  } catch {
    //same shape as absent
  }
  const firstWeekday = isWeekday(info?.firstDay) ? info.firstDay : 1
  const weekend =
    Array.isArray(info?.weekend) && info.weekend.every(isWeekday)
      ? [...info.weekend]
      : [6, 7]
  return { firstWeekday, weekend }
}

function separatorsOf(tag: string): {
  decimalSeparator: string
  groupingSeparator: string
} {
  let decimalSeparator = "."
  let groupingSeparator = ","
  try {
    //large enough to force a group, fractional enough to force a decimal
    for (const part of new Intl.NumberFormat(tag).formatToParts(
      1234567.89,
    )) {
      if (part.type === "decimal") decimalSeparator = part.value
      else if (part.type === "group") groupingSeparator = part.value
    }
  } catch {
    //the ASCII pair is the only honest guess left
  }
  return { decimalSeparator, groupingSeparator }
}

function zoneAndCalendarOf(tag: string): {
  timeZone: string
  calendar: string
} {
  try {
    const resolved = new Intl.DateTimeFormat(tag).resolvedOptions()
    return {
      timeZone: resolved.timeZone || "UTC",
      calendar: resolved.calendar || "gregory",
    }
  } catch {
    return { timeZone: "UTC", calendar: "gregory" }
  }
}

/**
 * The record for one tag. Pure and total: the same input gives an equal
 * record, and no input throws — an unparseable tag resolves as `"en"`.
 *
 * Every `Intl` call is made WITH the tag. That is the whole design: the engine's
 * default locale is frozen at process start (header), so it must never be
 * consulted, and a caller formatting a date should pass `languageTag` on too.
 */
export function resolveLocale(
  tag: string,
  preferred?: readonly string[],
): LocaleInfo {
  const { languageTag, locale } = parseTag(tag)
  return {
    languageTag,
    language: locale.language,
    script: locale.script ?? null,
    region: locale.region ?? null,
    direction: directionOf(locale),
    hourCycle: hourCycleOf(locale, languageTag),
    ...weekOf(locale),
    ...separatorsOf(languageTag),
    ...zoneAndCalendarOf(languageTag),
    preferred:
      preferred && preferred.length > 0 ? [...preferred] : [languageTag],
  }
}

/** What the platform said, verbatim — the cache key for {@link getLocale}. */
type Source = { tag: string; preferred: readonly string[] }

function readSource(): Source | null {
  if (typeof navigator === "undefined") return null
  const tag = navigator.language || FALLBACK_TAG
  const languages = navigator.languages
  const preferred =
    Array.isArray(languages) && languages.length > 0
      ? [...languages]
      : [tag]
  return { tag, preferred }
}

function sameSource(a: Source, b: Source): boolean {
  return (
    a.tag === b.tag &&
    a.preferred.length === b.preferred.length &&
    a.preferred.every((lang, i) => lang === b.preferred[i])
  )
}

let cached: { source: Source; info: LocaleInfo } | null = null
let server: LocaleInfo | null = null

/**
 * The current locale, synchronously. Reads `navigator.language` — on native
 * too, where it follows the OS (header) — and resolves `"en"` where there is no
 * navigator, i.e. on the server, which has no user to ask.
 *
 * The record is referentially stable between changes: the same object comes
 * back until the tag or the preference list actually moves, which is what lets
 * {@link subscribeLocale} feed `useSyncExternalStore` without a render loop.
 */
export function getLocale(): LocaleInfo {
  const source = readSource()
  if (!source) {
    server ??= resolveLocale(FALLBACK_TAG)
    return server
  }
  if (cached && sameSource(cached.source, source)) return cached.info
  cached = { source, info: resolveLocale(source.tag, source.preferred) }
  return cached.info
}

const listeners = new Set<() => void>()
let unbind: (() => void) | null = null

function check(): void {
  const before = cached?.info
  if (getLocale() === before) return
  for (const listener of listeners) listener()
}

function bind(): void {
  if (unbind || typeof window === "undefined") return
  window.addEventListener("languagechange", check)
  //a Settings round-trip is the one way the language changes on a phone, and
  //the app is in the background for all of it — re-read on the way back, and let
  //the cache decide whether anything actually moved
  const unbindResume = onResume(check)
  unbind = () => {
    window.removeEventListener("languagechange", check)
    unbindResume()
  }
}

/**
 * Subscribe to the locale changing; returns an unsubscribe. Notifies only when
 * the tag or the preference list changed — a `languagechange` that lands on the
 * same tag, or a resume with nothing new, is swallowed. SSR-safe (a no-op on
 * the server).
 *
 * Listens to the window's `languagechange` and to the app returning to the
 * foreground. See the header for which platforms fire the former: Android
 * native reloads the document instead, so there it is the resume that matters.
 */
export function subscribeLocale(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  listeners.add(listener)
  //prime the cache, so the first change is told apart from the first read
  getLocale()
  bind()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      unbind?.()
      unbind = null
    }
  }
}

/** Test seam — drops the cache and every subscription. */
export function resetLocale(): void {
  cached = null
  server = null
  listeners.clear()
  unbind?.()
  unbind = null
}
