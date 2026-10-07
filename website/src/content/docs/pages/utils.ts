import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "utils",
  title: "Utils",
  summary:
    "Synchronous platform detection, and the helpers the shell uses to stamp the page.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { isNativePlatform, isInstalledApp, getOS } from "@arrzdev/adaptv/utils"',
  source: "src/utils",
  blocks: [
    {
      type: "p",
      text: "adaptv exports no class merge. It joins class lists and does not merge them. To merge conflicting Tailwind classes of your own, bring `clsx` and `tailwind-merge`. See [Styling](/docs/styling).",
    },

    { type: "h2", text: "Platform detection" },
    {
      type: "p",
      text: "Two synchronous questions. The **shell** hosts the page: a browser tab, an installed PWA or the native app. The **OS** is what the device runs. iOS Safari is `ios` plus `web`. For both, write the `&&`.",
    },
    {
      type: "table",
      head: ["Question", "Whole answer", "Predicates"],
      rows: [
        [
          "Shell",
          '`resolvePlatformTag()`: `"web"`, `"standalone"` or `"native"`',
          "`isNativePlatform()`, `isStandaloneDisplay()`, `isInstalledApp()`",
        ],
        [
          "OS",
          '`getOS()`: `"ios"`, `"android"` or `"web"`',
          "`isIOS()`, `getOSVersion()`, `isOSVersionAtLeast()`",
        ],
      ],
    },
    {
      type: "props",
      rows: [
        {
          name: "isNativePlatform()",
          type: "() => boolean",
          description:
            "`true` in the native app. `false` in a browser and a PWA.",
        },
        {
          name: "isStandaloneDisplay()",
          type: "() => boolean",
          description: "`true` in an installed PWA. `false` in a native build.",
        },
        {
          name: "isInstalledApp()",
          type: "() => boolean",
          description: "Native or installed PWA. Like the `app:` variant.",
        },
        {
          name: "resolvePlatformTag()",
          type: '() => "web" | "standalone" | "native"',
          description: "The shell as one value. Type: `PlatformTag`.",
        },
        {
          name: "getOS()",
          type: '() => "ios" | "android" | "web"',
          description:
            'The device OS. `"web"` means desktop or other. Type: `PlatformOS`.',
        },
        {
          name: "isIOS()",
          type: "() => boolean",
          description: "`true` on iPhone, iPod and iPad.",
        },
        {
          name: "getOSVersion()",
          type: "() => string | null",
          description:
            '`"18.4"` or `"14"`, from the user agent. `null` on desktop.',
        },
        {
          name: "isOSVersionAtLeast(major, minor?)",
          type: "(major: number, minor?: number) => boolean",
          default: "minor = 0",
          description:
            "`true` if the OS is at or above `major.minor`. `false` if unknown.",
        },
      ],
    },
    {
      type: "note",
      tone: "warn",
      text: "Safari 26 keeps the iOS number at 18 in its user agent. On web, `isOSVersionAtLeast(26)` is `false`. A native build has the real number. On web, test the behaviour, not the version.",
    },
    {
      type: "code",
      label: "install-hint.tsx",
      lang: "tsx",
      code: `import { getOS, isInstalledApp } from "@arrzdev/adaptv/utils"

const [showHint, setShowHint] = useState(false)

useEffect(() => {
  setShowHint(!isInstalledApp() && getOS() === "ios")
}, [])`,
    },
    {
      type: "note",
      tone: "warn",
      text: 'On the server, these return `false`, `"web"` or `null`. Branching markup on them during render causes a hydration mismatch. Read them in an effect, as above, or use the `app:` and `web:` Tailwind variants. See [styling](/docs/styling).',
    },
    {
      type: "targets",
      rows: [
        { target: "Desktop web", status: "yes", note: '`"web"` and `"web"`.' },
        {
          target: "Mobile web",
          status: "yes",
          note: '`"web"` and `"ios"` or `"android"`.',
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: '`"standalone"`. `isInstalledApp()` is `true`.',
        },
        { target: "iOS", status: "yes", note: '`"native"` and `"ios"`.' },
        {
          target: "Android",
          status: "yes",
          note: '`"native"` and `"android"`.',
        },
      ],
    },

    { type: "h2", text: "EasingBezier" },
    {
      type: "api",
      name: "EasingBezier",
      signature: "type EasingBezier = [number, number, number, number]",
      description:
        "A cubic-bezier curve, `[x1, y1, x2, y2]`. It types the `easing` option of `useChromeTint` in [device hooks](/docs/hooks-device).",
    },
    {
      type: "code",
      label: "motion.ts",
      lang: "ts",
      code: `import type { EasingBezier } from "@arrzdev/adaptv/utils"

export const SHEET_EASE: EasingBezier = [0.32, 0.72, 0, 1]`,
    },

    { type: "h2", text: "Shell internals" },
    {
      type: "p",
      text: "The shell and the [Vite plugin](/docs/vite-plugin) use these to stamp `<html>` before first paint. An app does not call them.",
    },
    {
      type: "props",
      rows: [
        {
          name: "getPlatformInitScript(ui?)",
          type: "(ui?: AdaptvUiConfig) => string",
          description:
            "The blocking `<head>` script. It sets `data-adaptv-platform`, `data-adaptv-os` and one attribute for each `ui` option that is on.",
        },
        {
          name: "applyPlatformStamp(ui?)",
          type: "(ui?: AdaptvUiConfig) => void",
          description:
            "Set the attributes again from a layout effect. Pass the `ui` config.",
        },
        {
          name: "UI_STAMPS",
          type: "readonly [configKey, attribute][]",
          description:
            "`noSelect` sets `data-adaptv-no-select`. `hideScrollbars` sets `data-adaptv-hide-scrollbars`. `touchCallout` sets `data-adaptv-no-touch-callout`.",
        },
        {
          name: "normalizeUiScope(value, key?)",
          type: '(value: unknown, key?: keyof AdaptvUiConfig) => "app" | "all" | "off"',
          description:
            'Turn a config value into a scope. Unknown values become the default: `"app"` for `noSelect` and `touchCallout`, `"all"` for `hideScrollbars`.',
        },
        {
          name: "resolveUiStamp(scope, platform)",
          type: "(scope: UiPatchScope, platform: PlatformTag) => boolean",
          description:
            '`true` if a scope is on for a shell. `"app"` is on for `"standalone"` and `"native"`.',
        },
      ],
    },
  ],
}
