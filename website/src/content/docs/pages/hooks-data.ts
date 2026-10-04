import { HooksDataDemo } from "@/components/docs-demos/hooks-data-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "hooks-data",
  title: "Clipboard, share, location and network hooks",
  summary:
    "Copy and paste, the OS share sheet, the device position and connectivity, each with one API across every target and the gaps returned as values.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { useClipboard, useShare, useGeolocation, useIsOffline } from "@arrzdev/adaptv/hooks"',
  source: "src/hooks",
  blocks: [
    {
      type: "demo",
      component: HooksDataDemo,
      code: `import { useClipboard, useIsOffline } from "@arrzdev/adaptv/hooks"

const { copy, paste, canRead, readPermission, status, text } = useClipboard()
const isOffline = useIsOffline()

<Button onClick={() => copy("npm create adaptv@latest")}>Copy</Button>
{canRead && readPermission !== "unavailable" && (
  <Button onClick={() => paste()}>Paste</Button>
)}
<Text>status: {status ?? "none"}</Text>
<Text>{isOffline ? "offline" : "online"}</Text>`,
    },
    {
      type: "p",
      text: "These hooks share one rule: an expected refusal is a value, never an exception. No share sheet on desktop Chrome, a paste the browser refused, a denied location permission: each comes back as a status you can render. Every hook also reports whether the feature exists here, so a button can be left out of the first render instead of failing on tap.",
    },

    { type: "h2", text: "useClipboard" },
    {
      type: "api",
      name: "useClipboard()",
      signature: "function useClipboard(): UseClipboardResult",
      description:
        "Copy and paste text. Read and write are kept apart because they are different capabilities: copying is ungated almost everywhere, while pasting is a permission on Chromium and a per-gesture allowance on Safari and Firefox.",
      returns:
        "`{ canWrite, canRead, readPermission, copy, paste, text, status, refreshPermission }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "canWrite",
          type: "boolean",
          description:
            "Whether copying works here. `false` until mount, then `true` on every real target, including a plain-http origin, where copying falls back to `document.execCommand`.",
        },
        {
          name: "canRead",
          type: "boolean",
          description:
            "Whether pasting can work here. `false` until mount, and `false` on any insecure web origin: there is no fallback for reading.",
        },
        {
          name: "readPermission",
          type: '"granted" | "denied" | "prompt" | "unavailable"',
          description:
            'Read permission, without prompting. Starts as `"prompt"` and settles on mount. `"unavailable"` means do not render a paste button. Safari and Firefox always report `"prompt"`: they have no queryable permission and ask per gesture instead.',
        },
        {
          name: "copy",
          type: '(text: string) => Promise<"ok" | "denied" | "unsupported">',
          description: "Copy text. Never rejects.",
        },
        {
          name: "paste",
          type: "() => Promise<string | null>",
          description:
            "Read the clipboard. Resolves to the text, or `null` when refused or unsupported; `status` says which. Call it from a user gesture. Afterwards it re-reads the permission, because Chromium flips it to granted only once a read has happened.",
        },
        {
          name: "text",
          type: "string | null",
          description: "The last text `paste()` read.",
        },
        {
          name: "status",
          type: '"ok" | "denied" | "unsupported" | null',
          description:
            "Outcome of the last copy or paste, `null` before the first.",
        },
        {
          name: "refreshPermission",
          type: "() => Promise<ClipboardPermission>",
          description:
            "Re-read the permission, for example after the user changes it in site settings.",
        },
      ],
    },
    {
      type: "table",
      head: ["Status", "Meaning"],
      rows: [
        ['`"ok"`', "Done."],
        [
          '`"denied"`',
          "The platform refused: no user gesture, an unfocused document, or permission withheld. Retry from a real tap.",
        ],
        [
          '`"unsupported"`',
          "There is no clipboard path here, or the native plugin itself refused. A retry cannot help.",
        ],
      ],
    },
    {
      type: "code",
      label: "invite-code.tsx",
      lang: "tsx",
      code: `const { copy, status } = useClipboard()

<Button onClick={() => copy(code)}>
  {status === "ok" ? "Copied" : "Copy code"}
</Button>`,
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Copy works. Paste is a real permission on Chromium; Safari shows its own Paste button per read. On an http origin paste is unavailable.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Same as desktop web.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as the browser it was installed from.",
        },
        {
          target: "iOS",
          status: "yes",
          note: 'Both directions through the native pasteboard, no permission dialog. iOS shows its own "pasted from" banner.',
        },
        {
          target: "Android",
          status: "yes",
          note: "Both directions. Android 13+ shows its own copy confirmation, so a second in-app toast duplicates it.",
        },
      ],
    },

    { type: "h2", text: "useShare" },
    {
      type: "api",
      name: "useShare()",
      signature: "function useShare(): UseShareResult",
      description:
        "Open the OS share sheet. `supported` is the half people forget: desktop Chrome and every Firefox have no share sheet, and a share button rendered there does nothing. Branch on it to hide the button or swap it for copy-link.",
      returns: "`{ supported, canShare, share, outcome, sharing, error }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "supported",
          type: "boolean",
          description:
            "Whether a share sheet exists here. `false` on the server, correct from the first client render.",
        },
        {
          name: "canShare",
          type: "(target: ShareTarget) => boolean",
          description:
            "Whether this specific payload would go through. Check it whenever the payload has `files`: only the browser knows whether it has a handler for them.",
        },
        {
          name: "share",
          type: '(target: ShareTarget) => Promise<"shared" | "dismissed" | "unsupported" | null>',
          description:
            "Open the sheet. Resolves to the outcome, or `null` when the attempt threw, in which case `error` holds why. Call it directly in the tap handler: on web an `await` before the call loses the user activation and the browser throws.",
        },
        {
          name: "outcome",
          type: '"shared" | "dismissed" | "unsupported" | null',
          description: "The last outcome, `null` before the first attempt.",
        },
        {
          name: "sharing",
          type: "boolean",
          description: "`true` while the sheet is open.",
        },
        {
          name: "error",
          type: "Error | null",
          description:
            "A real failure, such as calling `share` outside a user gesture on web. A dismissed sheet is an outcome and does not set it.",
        },
      ],
    },
    { type: "h3", text: "ShareTarget" },
    {
      type: "props",
      rows: [
        {
          name: "title",
          type: "string",
          description: "Title of the shared item.",
        },
        { name: "text", type: "string", description: "Body text." },
        { name: "url", type: "string", description: "A link." },
        {
          name: "files",
          type: "File[]",
          description:
            'Web and PWA only. The native plugin takes file paths, and a `File` inside a WebView has none, so on native a payload with files reports `canShare: false` and `"unsupported"` instead of silently dropping them.',
        },
        {
          name: "dialogTitle",
          type: "string",
          description: "Title of the native chooser. Ignored on web.",
        },
      ],
    },
    {
      type: "code",
      label: "share-button.tsx",
      lang: "tsx",
      code: `const { supported, share } = useShare()

if (!supported) return <CopyLinkButton url={url} />

return (
  <Button onClick={() => share({ title: post.title, url })}>
    Share
  </Button>
)`,
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Safari has a share sheet. Chrome and Firefox have none, so `supported` is `false`.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "Safari and Chrome on Android both have it. File payloads are the ones most often refused; use `canShare`.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "Same as the mobile browser.",
        },
        {
          target: "iOS",
          status: "yes",
          note: 'The system share sheet. A dismissed sheet reports `"dismissed"`. No file payloads.',
        },
        {
          target: "Android",
          status: "yes",
          note: 'The system chooser. It resolves as `"shared"` whether or not the user picked an app. No file payloads.',
        },
      ],
    },
    {
      type: "note",
      tone: "info",
      text: "The source comments disagree about `dialogTitle`: the type says it is for native iOS and ignored on Android, while the framework's own test page says Android honours it and iOS ignores it. It is passed to the native plugin on both. Treat it as optional decoration.",
    },

    { type: "h2", text: "useGeolocation" },
    {
      type: "api",
      name: "useGeolocation()",
      signature: "function useGeolocation(): UseGeolocationResult",
      description:
        "Read the device position once, on demand. Nothing is requested on mount: call `locate()` from a user gesture, and it asks for permission if needed and then reads the position. There is no continuous watch today.",
      returns:
        "`{ coords, permission, error, loading, locate, refreshPermission }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "coords",
          type: "{ latitude: number; longitude: number; accuracy: number } | null",
          description: "The last position read. `accuracy` is in metres.",
        },
        {
          name: "permission",
          type: '"granted" | "denied" | "prompt" | "unavailable"',
          description:
            'Starts as `"prompt"` and is not read on mount; call `refreshPermission()` in an effect if the first render needs the real state. `"unavailable"` means location cannot be used at all right now: no API (an http origin), or system location services switched off.',
        },
        {
          name: "error",
          type: "Error | null",
          description:
            "Why the last `locate()` failed: permission not granted, a timeout, or no fix.",
        },
        {
          name: "loading",
          type: "boolean",
          description: "`true` while `locate()` runs.",
        },
        {
          name: "locate",
          type: "(options?: GeoOptions) => Promise<GeoCoords | null>",
          description:
            "Request permission if needed, then read the position. Resolves to the coordinates, or `null` on failure with `error` set. Never rejects.",
        },
        {
          name: "refreshPermission",
          type: "() => Promise<GeoPermission>",
          description: "Re-read the permission without prompting.",
        },
      ],
    },
    { type: "h3", text: "GeoOptions" },
    {
      type: "props",
      rows: [
        {
          name: "highAccuracy",
          type: "boolean",
          default: "false",
          description: "Ask for GPS-grade accuracy. Slower, and costs battery.",
        },
        {
          name: "timeoutMs",
          type: "number",
          default: "10000",
          description: "Give up after this many ms.",
        },
      ],
    },
    {
      type: "code",
      label: "nearby.tsx",
      lang: "tsx",
      code: `const { coords, permission, error, loading, locate } = useGeolocation()

if (permission === "unavailable") return <Text>Location is off on this device.</Text>
if (permission === "denied") return <Text>Allow location in settings to see what is nearby.</Text>

return (
  <Button onClick={() => locate({ highAccuracy: true })} disabled={loading}>
    {coords ? "Refresh" : "Find places near me"}
  </Button>
)`,
    },
    {
      type: "note",
      tone: "info",
      text: 'Send the user to different places for the two dead ends: `"denied"` is fixed in the app\'s or site\'s own permission settings, `"unavailable"` in the system location settings. On web there is no separate permission request, so `locate()` reads the position once to raise the browser prompt and then reads it again for the result.',
    },
    {
      type: "note",
      tone: "warn",
      text: "Native builds need the OS permission declared: `NSLocationWhenInUseUsageDescription` in the iOS `Info.plist` and `ACCESS_FINE_LOCATION` in the Android manifest. adaptv does not generate either today, and without them the first `locate()` on a device fails. Add them to the native project by hand; see [native builds](/docs/native-builds).",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: 'HTTPS or localhost only. On a plain-http origin the API is absent and `permission` reads `"unavailable"` after a refresh.',
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Same secure-origin rule.",
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: "Same as the browser. The grant is remembered per origin.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "The iOS permission sheet. After a denial the OS does not ask again; the user has to change it in Settings.",
        },
        {
          target: "Android",
          status: "yes",
          note: "The runtime permission dialog. Two denials become permanent.",
        },
      ],
    },

    { type: "h2", text: "useIsOffline" },
    {
      type: "api",
      name: "useIsOffline()",
      signature: "function useIsOffline(): boolean",
      description:
        "Reactive connectivity. `true` is trustworthy: the device has no connection. `false` on web only means a network interface exists, which a captive portal or a router with no upstream also satisfies.",
      returns:
        "`true` when offline. `false` on the server and during hydration.",
    },
    {
      type: "code",
      label: "submit.tsx",
      lang: "tsx",
      code: `const isOffline = useIsOffline()

<Button disabled={isOffline} onClick={submit}>
  {isOffline ? "You are offline" : "Send"}
</Button>`,
    },
    {
      type: "p",
      text: "Use it for an indicator, a disabled submit button, a banner over content that is still live. Do not use it alone to decide whether to show an offline screen: offline with cached data should render normally, and online with a failed request usually wants the same screen as offline. The question to ask is whether you have anything to show. See the [offline guide](/docs/offline) and [OfflineBoundary](/docs/offline-boundary).",
    },
    {
      type: "p",
      text: "To feed a data library's online manager, use `getOnline` and `subscribeOnline` from [capabilities](/docs/capabilities).",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "`navigator.onLine` and the `online` / `offline` events. Coarse by construction.",
        },
        { target: "Mobile web", status: "partial", note: "Same." },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same. The service worker can keep the app working while this reads offline.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "Event-driven from the OS. Accurate enough to gate a sync on. Reads online until the first native status arrives.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Same. Doze mode can delay an event by a few seconds on a sleeping device.",
        },
      ],
    },
  ],
}
