import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "hooks-system",
  title: "System and accessibility hooks",
  summary:
    "Read the app version, the battery, the language, the motion sensors and the screen reader. Announce a message to assistive technology.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { useAppInfo, useBattery, useLocale, useMotion, useScreenReader } from "adaptv/hooks"',
  source: "src/hooks",
  blocks: [
    {
      type: "p",
      text: "Each hook reads a fact the system owns and re-renders when it changes. All of them are safe during server rendering. The server and the first client render show a fixed value, so hydration matches. Outside a component, import the matching function from `adaptv/capabilities`.",
    },

    { type: "h2", text: "useAppInfo" },
    {
      type: "api",
      name: "useAppInfo()",
      signature: "function useAppInfo(): UseAppInfoResult",
      description:
        "The name, identity, version and build of the running app. Use it for an About row or a bug report. It reads once per process, because none of these change while the app is alive.",
      returns: "`{ info, caveat }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "info",
          type: "AppInfo | null",
          description:
            "`null` until the first read resolves. Then a record that never changes.",
        },
        {
          name: "caveat",
          type: "string | null",
          description:
            "A sentence that says why a field is empty on this target, or `null` when the target answers everything.",
        },
      ],
    },
    { type: "h3", text: "AppInfo" },
    {
      type: "props",
      rows: [
        {
          name: "name",
          type: "string | null",
          description:
            "The display name. Native: the binary's. Web: the manifest `name`, then `short_name`.",
        },
        {
          name: "id",
          type: "string | null",
          description: "Native: the bundle id. Web: the manifest `id`.",
        },
        {
          name: "version",
          type: "string | null",
          description: 'The store version, such as `"1.4.0"`. `null` on web.',
        },
        {
          name: "build",
          type: "string | null",
          description: 'The build number, such as `"42"`. `null` on web.',
        },
      ],
    },
    {
      type: "code",
      label: "about-row.tsx",
      lang: "tsx",
      code: `const { info, caveat } = useAppInfo()

if (!info) return <Text>Reading…</Text>
return (
  <View>
    <Text>{info.name} {info.version ?? ""}</Text>
    {caveat && <Text>{caveat}</Text>}
  </View>
)`,
    },
    {
      type: "note",
      tone: "info",
      text: "`version` and `build` describe the installed binary. An [OTA update](/docs/ota-updates) changes the live bundle without changing `version`.",
    },
    {
      type: "p",
      text: "Outside React, `getAppInfo()` returns the same record as a promise, and `getAppInfoCaveat()` returns the caveat. The promise never rejects. A field it cannot read is `null`.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "`name` and `id` from the web manifest. `version` and `build` are `null`.",
        },
        { target: "Mobile web", status: "partial", note: "Same as desktop." },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as desktop.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "All four fields. A binary built before the app plugin falls back to the manifest and `version` and `build` read `null`. A rebuild fixes it.",
        },
        {
          target: "Android",
          status: "yes",
          note: "All four fields. A binary built before the app plugin falls back to the manifest and `version` and `build` read `null`. A rebuild fixes it.",
        },
      ],
    },

    { type: "h2", text: "useBattery" },
    {
      type: "api",
      name: "useBattery()",
      signature: "function useBattery(): BatteryState",
      description:
        "The charge level and whether the device is charging. The hook re-renders when either moves.",
      returns: "`{ status, level, charging }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "status",
          type: '"ok" | "unknown" | "unsupported"',
          description:
            '`"ok"` carries numbers. `"unknown"`: the platform has a battery API and gave no usable level, such as the iOS simulator. `"unsupported"`: there is no battery API. This is the server value.',
        },
        {
          name: "level",
          type: "number | null",
          description: 'Charge from 0 to 1. `null` unless `status` is `"ok"`.',
        },
        {
          name: "charging",
          type: "boolean | null",
          description:
            "`true` while plugged in. `null` when the platform cannot say.",
        },
      ],
    },
    {
      type: "code",
      label: "battery-badge.tsx",
      lang: "tsx",
      code: `const { status, level, charging } = useBattery()

if (status !== "ok" || level === null) return null
return <Text>{Math.round(level * 100)}%{charging ? " (charging)" : ""}</Text>`,
    },
    {
      type: "p",
      text: "On native the value is re-read when the app returns to the foreground and every 60 seconds while a component uses it. Outside React, use `getBatteryState()`, `readBattery()` and `subscribeBattery(cb)`.",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: 'Chromium only. A desktop without a battery reports level 1 and charging. Safari and Firefox report `"unsupported"`.',
        },
        {
          target: "Mobile web",
          status: "partial",
          note: 'Chromium only. iOS browsers report `"unsupported"`.',
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as the browser engine.",
        },
        {
          target: "iOS",
          status: "yes",
          note: 'The simulator reports `"unknown"`.',
        },
        { target: "Android", status: "yes" },
      ],
    },

    { type: "h2", text: "useLocale" },
    {
      type: "api",
      name: "useLocale()",
      signature: "function useLocale(): LocaleInfo",
      description:
        "The language the user asked for and what it implies: text direction, hour cycle, week, number separators, time zone and calendar. Every field is always filled. The record is the same object until the tag or the preference list changes.",
      returns: "A `LocaleInfo` record.",
    },
    {
      type: "props",
      rows: [
        {
          name: "languageTag",
          type: "string",
          description: 'The canonical BCP-47 tag, such as `"pt-PT"`.',
        },
        {
          name: "language",
          type: "string",
          description: 'The language subtag, `"pt"`.',
        },
        {
          name: "script",
          type: "string | null",
          description: '`"Hant"` when the tag has a script, else `null`.',
        },
        {
          name: "region",
          type: "string | null",
          description: '`"PT"`. `null` for a bare `"de"`.',
        },
        {
          name: "direction",
          type: '"ltr" | "rtl"',
          description: "The text direction.",
        },
        {
          name: "hourCycle",
          type: '"h12" | "h23"',
          description: '`"h12"` for 3:07 PM, `"h23"` for 15:07.',
        },
        {
          name: "firstWeekday",
          type: "number",
          description: "First day of the week. 1 is Monday, 7 is Sunday.",
        },
        {
          name: "weekend",
          type: "number[]",
          description: "The weekend days in the same numbering.",
        },
        {
          name: "decimalSeparator",
          type: "string",
          description: '`"."` or `","`.',
        },
        {
          name: "groupingSeparator",
          type: "string",
          description: "What groups the thousands.",
        },
        {
          name: "timeZone",
          type: "string",
          description:
            'An IANA zone, such as `"Europe/Lisbon"`. `"UTC"` if the runtime will not say.',
        },
        {
          name: "calendar",
          type: "string",
          description: 'The tag\'s default calendar, such as `"gregory"`.',
        },
        {
          name: "preferred",
          type: "string[]",
          description:
            "The ranked language list from `navigator.languages`, or the tag alone when that list is empty.",
        },
      ],
    },
    {
      type: "code",
      label: "price.tsx",
      lang: "tsx",
      code: `const { languageTag, direction } = useLocale()

const price = new Intl.NumberFormat(languageTag, {
  style: "currency",
  currency: "EUR",
}).format(1234.5)

return <Text dir={direction}>{price}</Text>`,
    },
    {
      type: "note",
      tone: "warn",
      text: "Pass `languageTag` to every `Intl` call and every `toLocale*` method. The engine's default locale is fixed when the process starts and does not follow a language change, so a call without the tag keeps the boot language.",
    },
    {
      type: "p",
      text: "The server has no user to ask. It renders `en` with the time zone pinned to `UTC`, so hydration compares the same record. Outside React, use `getLocale()` and `subscribeLocale(listener)`. `resolveLocale(tag, preferred?)` builds the record for any tag and never throws. A tag it cannot parse becomes `en`. For the device model and OS, see [useDevice](/docs/hooks-device).",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: "Updates on the browser's `languagechange` event.",
        },
        { target: "Mobile web", status: "yes", note: "Same as desktop." },
        { target: "Installed PWA", status: "yes", note: "Same as desktop." },
        {
          target: "iOS",
          status: "yes",
          note: "Re-read when the app returns to the foreground.",
        },
        {
          target: "Android",
          status: "yes",
          note: "A per-app language change reloads the WebView, so the record is correct at boot. Re-read on resume.",
        },
      ],
    },

    { type: "h2", text: "useMotion" },
    {
      type: "api",
      name: "useMotion()",
      signature:
        "function useMotion(options?: UseMotionOptions): UseMotionResult",
      description:
        "Accelerometer and gyroscope samples, with the permission step and the no-sensor case named. Every instance shares one permission answer.",
      params: [
        {
          name: "options",
          type: "UseMotionOptions",
          description: "See the table below.",
        },
      ],
      returns: "`{ status, sample, silent, request }`.",
    },
    { type: "h3", text: "UseMotionOptions" },
    {
      type: "props",
      rows: [
        {
          name: "enabled",
          type: "boolean",
          default: "true",
          description: "`false` keeps the listener off.",
        },
        {
          name: "throttleMs",
          type: "number",
          default: "100",
          description:
            "At most one re-render per this many ms. `0` renders every event.",
        },
        {
          name: "silentAfterMs",
          type: "number",
          default: "1500",
          description:
            "Report `silent` after this many ms without a usable sample.",
        },
      ],
    },
    { type: "h3", text: "UseMotionResult" },
    {
      type: "props",
      rows: [
        {
          name: "status",
          type: '"unsupported" | "prompt" | "granted" | "denied"',
          description:
            '`"prompt"`: the engine asks when `request` runs from a gesture. `"granted"`: events may arrive. `"unsupported"`: no `devicemotion` here, including the server.',
        },
        {
          name: "sample",
          type: "MotionSample | null",
          description: "The latest sample. `null` before the first.",
        },
        {
          name: "silent",
          type: "boolean",
          description:
            "`true` when permission is granted and no usable sample arrived within `silentAfterMs`. A desktop, the iOS simulator or a device with the sensor off. It clears when samples resume.",
        },
        {
          name: "request",
          type: "() => Promise<MotionStatus>",
          description:
            "Ask for permission. Call it from a tap. Resolves the new status.",
        },
      ],
    },
    { type: "h3", text: "MotionSample" },
    {
      type: "props",
      rows: [
        {
          name: "acceleration",
          type: "{ x, y, z } | null",
          description:
            "Linear acceleration in m/s² with gravity removed. `null` when the engine cannot separate it.",
        },
        {
          name: "gravity",
          type: "{ x, y, z } | null",
          description:
            "Acceleration including gravity in m/s². The raw accelerometer.",
        },
        {
          name: "rotation",
          type: "{ alpha, beta, gamma } | null",
          description: "Rotation rate in deg/s. `null` without a gyroscope.",
        },
        {
          name: "interval",
          type: "number",
          description: "The engine's sampling interval in ms.",
        },
        {
          name: "at",
          type: "number",
          description: "`performance.now()` when the sample arrived.",
        },
      ],
    },
    {
      type: "code",
      label: "level.tsx",
      lang: "tsx",
      code: `const { status, sample, silent, request } = useMotion({ throttleMs: 50 })

if (status === "prompt") return <Button onClick={request}>Enable motion</Button>
if (status === "denied") return <Text>Motion access was refused.</Text>
if (status === "unsupported" || silent) return <Text>No motion sensor.</Text>
return <Text>{sample?.gravity?.x.toFixed(2)}</Text>`,
    },
    {
      type: "p",
      text: 'Outside React, use `getMotionStatus()`, `requestMotionPermission()`, `subscribeMotionStatus(cb)` and `subscribeMotion(listener, { throttleMs })`. `subscribeMotion` does nothing unless the status is `"granted"`.',
    },
    {
      type: "note",
      tone: "info",
      text: 'WebKit rejects the permission request outside a user gesture and shows nothing. adaptv keeps the status at `"prompt"` in that case, so a later tap can ask again. Only a resolved `"denied"` is a refusal. `DeviceMotionEvent` exists only in a secure context. A dev server on a plain-http LAN address reports `"unsupported"` in the browser.',
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: 'Chromium: granted from the start, but a desktop has no sensor, so `silent` becomes `true`. Desktop Safari has no motion API and reads `"unsupported"`.',
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "iOS Safari asks, from a tap. Chromium on Android is granted from the start.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as the browser engine.",
        },
        {
          target: "iOS",
          status: "partial",
          note: "The WebView is WebKit, so the permission step applies. The simulator has no sensor.",
        },
        {
          target: "Android",
          status: "yes",
          note: "The WebView has no permission gate.",
        },
      ],
    },

    { type: "h2", text: "useScreenReader" },
    {
      type: "api",
      name: "useScreenReader()",
      signature: "function useScreenReader(): UseScreenReaderResult",
      description:
        "Whether a screen reader is running, and a way to announce a message to it.",
      returns: "`{ status, announce }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "status",
          type: '"on" | "off" | "unknown"',
          description:
            'The OS\'s last answer. `"unknown"` on the web, on the server and in a binary built without the plugin.',
        },
        {
          name: "announce",
          type: "(text: string, options?: AnnounceOptions) => Promise<AnnounceOutcome>",
          description: "Say something to the reader. Never rejects.",
        },
      ],
    },
    { type: "h3", text: "announce" },
    {
      type: "table",
      head: ["Option or outcome", "Meaning"],
      rows: [
        [
          "`language`",
          "ISO 639-1 code of the text. Android speech and the web live region's `lang` use it.",
        ],
        [
          '`"announced"`',
          "Handed to a reader, or written to the live region on web.",
        ],
        [
          '`"silent"`',
          "Native with no reader running, or the plugin call failed.",
        ],
        [
          '`"unsupported"`',
          "Nothing can carry it: the server, or a binary without the plugin.",
        ],
      ],
    },
    {
      type: "code",
      label: "save-button.tsx",
      lang: "tsx",
      code: `const { announce } = useScreenReader()

async function save() {
  await saveDraft()
  await announce("Draft saved")
}`,
    },
    {
      type: "p",
      text: 'On web, `announce` writes to one polite ARIA live region that adaptv adds to the page. A running reader speaks it. Without a reader it costs nothing. No browser can say whether a reader is running, which is why `status` stays `"unknown"`. On native, adaptv announces only while a reader is on. Outside React, use `getScreenReaderState()`, `readScreenReader()`, `subscribeScreenReader(cb)` and `announce()`. To speak to every user, use `useSpeech` from `adaptv/hooks`.',
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: 'Status is `"unknown"`. `announce` uses the live region.',
        },
        { target: "Mobile web", status: "partial", note: "Same as desktop." },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as desktop.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "VoiceOver. Status follows the OS and is re-read on resume.",
        },
        {
          target: "Android",
          status: "yes",
          note: "TalkBack, read as touch exploration. Switch Access and Voice Access do not count as readers.",
        },
      ],
    },
  ],
}
