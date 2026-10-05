import { HooksDataDemo } from "@/components/docs-demos/hooks-data-demo"
import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "hooks-data",
  title: "Clipboard, share, location and network hooks",
  summary:
    "Copy and paste, the share sheet, the device position and the connection state.",
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
      text: "These hooks do not throw when the platform refuses. The refusal is a value that you can render.",
    },

    { type: "h2", text: "useClipboard" },
    {
      type: "api",
      name: "useClipboard()",
      signature: "function useClipboard(): UseClipboardResult",
      description: "Copy and paste text.",
      returns:
        "`{ canWrite, canRead, readPermission, copy, paste, text, status, refreshPermission }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "canWrite",
          type: "boolean",
          description: "`true` if copy works. `false` until mount.",
        },
        {
          name: "canRead",
          type: "boolean",
          description:
            "`true` if paste can work. `false` until mount and on insecure web origins.",
        },
        {
          name: "readPermission",
          type: '"granted" | "denied" | "prompt" | "unavailable"',
          description:
            'Starts as `"prompt"`. Hide the paste button on `"unavailable"`. Safari and Firefox always give `"prompt"`.',
        },
        {
          name: "copy",
          type: '(text: string) => Promise<"ok" | "denied" | "unsupported">',
          description: "Copy text. It never rejects.",
        },
        {
          name: "paste",
          type: "() => Promise<string | null>",
          description:
            "Read the clipboard. Returns `null` if refused. Call it from a user gesture.",
        },
        {
          name: "text",
          type: "string | null",
          description: "The last text that `paste()` read.",
        },
        {
          name: "status",
          type: '"ok" | "denied" | "unsupported" | null',
          description: "Result of the last copy or paste.",
        },
        {
          name: "refreshPermission",
          type: "() => Promise<ClipboardPermission>",
          description: "Read the permission again.",
        },
      ],
    },
    {
      type: "table",
      head: ["Status", "Meaning"],
      rows: [
        ['`"ok"`', "Done."],
        ['`"denied"`', "The platform refused. Retry from a real tap."],
        ['`"unsupported"`', "No clipboard path exists. Do not retry."],
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
          note: "Paste needs a permission on Chromium. It is not available on http.",
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Same as desktop web.",
        },
        {
          target: "Installed PWA",
          status: "partial",
          note: "Same as the browser.",
        },
        {
          target: "iOS",
          status: "yes",
          note: "No permission dialog. iOS shows its own paste banner.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Android 13+ shows its own copy message.",
        },
      ],
    },

    { type: "h2", text: "useShare" },
    {
      type: "api",
      name: "useShare()",
      signature: "function useShare(): UseShareResult",
      description:
        "Open the share sheet. Desktop Chrome and Firefox have none. If `supported` is `false`, hide the button or show a copy-link button.",
      returns: "`{ supported, canShare, share, outcome, sharing, error }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "supported",
          type: "boolean",
          description: "`true` if a share sheet exists. `false` on the server.",
        },
        {
          name: "canShare",
          type: "(target: ShareTarget) => boolean",
          description:
            "`true` if this payload can be shared. Check it for files.",
        },
        {
          name: "share",
          type: '(target: ShareTarget) => Promise<"shared" | "dismissed" | "unsupported" | null>',
          description:
            "Open the sheet. Returns `null` if it threw. Then `error` has the cause. Call it from a tap handler. On web, it throws outside a user gesture.",
        },
        {
          name: "outcome",
          type: '"shared" | "dismissed" | "unsupported" | null',
          description: "The last outcome.",
        },
        {
          name: "sharing",
          type: "boolean",
          description: "`true` while the sheet is open.",
        },
        {
          name: "error",
          type: "Error | null",
          description: "A real failure. A dismissed sheet does not set it.",
        },
      ],
    },
    { type: "h3", text: "ShareTarget" },
    {
      type: "props",
      rows: [
        { name: "title", type: "string", description: "Title." },
        { name: "text", type: "string", description: "Body text." },
        { name: "url", type: "string", description: "A link." },
        {
          name: "files",
          type: "File[]",
          description:
            'Web only. On native, a payload with `files` gives `"unsupported"`. Use `storedFiles`.',
        },
        {
          name: "storedFiles",
          type: "StoredFile[]",
          description:
            "Files you wrote with the filesystem capability, as `{ path, scope?, type? }`. Works on every target. `share` rejects if a path is missing.",
        },
        {
          name: "dialogTitle",
          type: "string",
          description: "Sheet title. iOS only.",
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
          note: "Safari has a sheet. Chrome and Firefox do not.",
        },
        {
          target: "Mobile web",
          status: "yes",
          note: "Browsers often refuse files.",
        },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: 'A dismissed sheet gives `"dismissed"`.',
        },
        {
          target: "Android",
          status: "yes",
          note: 'Gives `"shared"` even if the user picks nothing.',
        },
      ],
    },

    { type: "h2", text: "useGeolocation" },
    {
      type: "api",
      name: "useGeolocation()",
      signature: "function useGeolocation(): UseGeolocationResult",
      description:
        "Read the position once. Nothing runs on mount. Call `locate()` from a user gesture. There is no continuous watch.",
      returns:
        "`{ coords, permission, error, loading, locate, refreshPermission }`.",
    },
    {
      type: "props",
      rows: [
        {
          name: "coords",
          type: "{ latitude: number; longitude: number; accuracy: number } | null",
          description: "The last position. `accuracy` is in metres.",
        },
        {
          name: "permission",
          type: '"granted" | "denied" | "prompt" | "unavailable"',
          description:
            'Starts as `"prompt"`. Call `refreshPermission()` for the real state. `"unavailable"` means location cannot work now.',
        },
        {
          name: "error",
          type: "Error | null",
          description: "Why the last `locate()` failed.",
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
            "Ask for permission, then read the position. Returns `null` on failure. It never rejects.",
        },
        {
          name: "refreshPermission",
          type: "() => Promise<GeoPermission>",
          description: "Read the permission again, without a prompt.",
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
          description: "Ask for GPS accuracy. Uses more battery.",
        },
        {
          name: "timeoutMs",
          type: "number",
          default: "10000",
          description: "Give up after this many milliseconds.",
        },
      ],
    },
    {
      type: "code",
      label: "nearby.tsx",
      lang: "tsx",
      code: `const { coords, permission, loading, locate } = useGeolocation()

if (permission === "unavailable") return <Text>Location is off on this device.</Text>
if (permission === "denied") return <Text>Allow location in settings.</Text>

return (
  <Button onClick={() => locate({ highAccuracy: true })} disabled={loading}>
    {coords ? "Refresh" : "Find places near me"}
  </Button>
)`,
    },
    {
      type: "note",
      tone: "info",
      text: 'Fix `"denied"` in the app or site permissions. Fix `"unavailable"` in the system location settings.',
    },
    {
      type: "note",
      tone: "warn",
      text: "Native builds need the OS permission: `NSLocationWhenInUseUsageDescription` in the iOS `Info.plist` and `ACCESS_FINE_LOCATION` in the Android manifest. adaptv does not add them. Without them, `locate()` fails. See [native builds](/docs/native-builds).",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: 'HTTPS or localhost only. On http the browser refuses the request, so it reads as `"denied"`, not `"unavailable"`.',
        },
        {
          target: "Mobile web",
          status: "partial",
          note: "Same as desktop web.",
        },
        { target: "Installed PWA", status: "yes" },
        {
          target: "iOS",
          status: "yes",
          note: "After a denial, the user must use Settings.",
        },
        {
          target: "Android",
          status: "yes",
          note: "Two denials are permanent.",
        },
      ],
    },

    { type: "h2", text: "useIsOffline" },
    {
      type: "api",
      name: "useIsOffline()",
      signature: "function useIsOffline(): boolean",
      description:
        "The connection state. `true` means no connection. On web, `false` only means a network interface exists.",
      returns: "`true` when offline. `false` on the server.",
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
      text: "Use it for an indicator, a disabled button or a banner. Do not use it alone to show an offline screen. Ask if you have anything to show. See [offline](/docs/offline) and [OfflineBoundary](/docs/offline-boundary). To feed a data library, use `getOnline` and `subscribeOnline` from [capabilities](/docs/capabilities).",
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "partial",
          note: "Uses `navigator.onLine`. It is coarse.",
        },
        { target: "Mobile web", status: "partial", note: "Same." },
        { target: "Installed PWA", status: "partial", note: "Same." },
        {
          target: "iOS",
          status: "yes",
          note: "Driven by the OS. Reads online until the first status arrives.",
        },
        { target: "Android", status: "yes", note: "Same as iOS." },
      ],
    },
  ],
}
