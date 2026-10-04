import type { DocPage } from "@/content/docs/types"

export const page: DocPage = {
  slug: "utils",
  title: "Utils",
  summary:
    "Class merging that understands adaptv's utilities, layered style merging for your own primitives, and synchronous platform detection.",
  platforms: ["Web", "PWA", "iOS", "Android"],
  importLine:
    'import { cn, mergeStyles, isNativePlatform, isInstalledApp, getOS } from "@arrzdev/adaptv/utils"',
  source: "src/utils",
  blocks: [
    { type: "h2", text: "cn" },
    {
      type: "api",
      name: "cn()",
      signature: "function cn(...inputs: ClassValue[]): string",
      description:
        "Join class names and resolve Tailwind conflicts so the last one wins. It is `clsx` followed by `tailwind-merge`, with the merge taught about adaptv's own utilities. Use this `cn` rather than a local copy: a stock `tailwind-merge` does not know that `pb-safe` and `pb-4` set the same property, and keeps both.",
      params: [
        {
          name: "inputs",
          type: "ClassValue[]",
          required: true,
          description:
            "Anything `clsx` accepts: strings, arrays, objects of `{ className: condition }`, and falsy values, which are skipped.",
        },
      ],
      returns: "One class string.",
    },
    {
      type: "code",
      label: "card.tsx",
      lang: "tsx",
      code: `import { cn } from "@arrzdev/adaptv/utils"

cn("rounded-xl p-4", isActive && "bg-blue-500", className)

cn("pb-4", "pb-safe")            // "pb-safe"
cn("p-4", "pt-safe-offset-2")    // "p-4 pt-safe-offset-2"
cn("select-none", "selectable")  // "selectable"`,
    },
    { type: "p", text: "What it knows beyond stock Tailwind:" },
    {
      type: "ul",
      items: [
        "**Safe-area utilities.** `safe`, `safe-offset-N` and `safe-or-N` on every padding, margin and inset prefix (`p`, `px`, `pt`, `m`, `mb`, `inset`, `top`, `bottom`, `start`, `end` and the rest) belong to the same conflict groups as their numeric siblings. So `pb-safe` replaces `pb-0`, and `p-4` still loses to a later `pt-safe`. See [safe areas](/docs/safe-areas).",
        "**`selectable`** conflicts with Tailwind's `select-*` classes, in both directions.",
        "**`scrollbar-hidden` and `scrollbar-visible`** conflict with each other.",
        "**`overflow-x-*` and `overflow-y-*` remove an earlier `overflow-*` shorthand**, so a locked scroll axis beats a stray `overflow-hidden` by resolution instead of by stylesheet order.",
      ],
    },

    { type: "h2", text: "mergeStyles" },
    {
      type: "api",
      name: "mergeStyles()",
      signature:
        "function mergeStyles(layers: StyleLayers & InlineStyleLayers): string | { className: string; style: CSSProperties | undefined }",
      description:
        "Compose the classes, and optionally the inline styles, of a primitive in three tiers: a default look the consumer may override, the consumer's own classes, and structural declarations the consumer must not break. adaptv's components are built with it, and it is exported so a design-system wrapper can follow the same contract. The class tier resolves through `cn`, so later tiers win conflicts. The inline tier is an object spread, last one wins per property.",
      params: [
        {
          name: "base",
          type: "ClassValue",
          description: "The neutral default look. Anything may override it.",
        },
        {
          name: "className",
          type: "ClassValue",
          description:
            "The consumer's classes. They override `base` and never `locked`.",
        },
        {
          name: "locked",
          type: "ClassValue",
          description:
            "Structural classes the primitive depends on. Applied last, so they win over both.",
        },
        {
          name: "baseStyle",
          type: "CSSProperties",
          description: "Default inline style. The inline twin of `base`.",
        },
        {
          name: "style",
          type: "CSSProperties",
          description: "The consumer's inline style.",
        },
        {
          name: "lockedStyle",
          type: "CSSProperties",
          description: "Structural inline style. Wins per property.",
        },
      ],
      returns:
        "A class string when only class tiers were passed. `{ className, style }` as soon as any of the three inline keys is present in the object, even with the value `undefined`. `style` is `undefined` when nothing was declared, so you never hand React a fresh empty object each render.",
    },
    {
      type: "code",
      label: "scroll-area.tsx",
      lang: "tsx",
      code: `import { mergeStyles } from "@arrzdev/adaptv/utils"

function ScrollArea({ className, style, ...rest }: ScrollAreaProps) {
  const merged = mergeStyles({
    base: "flex flex-col gap-2",
    className,
    locked: "overflow-y-auto overscroll-contain",
    style,
    lockedStyle: { WebkitOverflowScrolling: "touch" },
  })
  return <div {...rest} className={merged.className} style={merged.style} />
}`,
    },
    {
      type: "p",
      text: "The inline tier exists because an inline `style` beats every stylesheet rule. A primitive that forwards the consumer's `style` untouched has already lost its `locked` classes to it. Route it through `mergeStyles` and the same three tiers hold.",
    },
    {
      type: "note",
      tone: "info",
      text: "Two limits. It guards against accidents, not intent: a consumer holding a ref can still write `el.style` after paint. And the class tier only resolves conflicts `cn` knows about. If you add a custom Tailwind `@utility` that sets a property and put it in `locked`, a consumer class for the same property is not removed, and stylesheet order decides the winner. Use `lockedStyle` for that case.",
    },
    {
      type: "p",
      text: "The exported types are `StyleLayers` (`base`, `className`, `locked`), `InlineStyleLayers` (`baseStyle`, `style`, `lockedStyle`) and `MergedStyles` (`{ className, style }`).",
    },

    { type: "h2", text: "Platform detection" },
    {
      type: "p",
      text: 'Synchronous answers to "what am I running in". There are two independent questions. The **shell** is what hosts the page: a browser tab, an installed PWA, or the native app. The **OS** is what the device runs. iOS Safari is `ios` plus `web`; an iOS native build is `ios` plus `native`. There is no combined predicate such as "is Android native": write the `&&`.',
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
            "`true` inside the native iOS or Android app. `false` in a browser and in an installed PWA.",
        },
        {
          name: "isStandaloneDisplay()",
          type: "() => boolean",
          description:
            "`true` in an installed PWA (`display-mode: standalone`, or `navigator.standalone` on older iOS). A native build reports `false` here, because its WebView says `browser`.",
        },
        {
          name: "isInstalledApp()",
          type: "() => boolean",
          description:
            'Native or installed PWA. This is the one to use when you mean "not a browser tab", and it is the same idea as the `app:` CSS variant.',
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
            'The device OS: from the native shell in a native build, otherwise from the user agent. `"web"` means desktop or anything else. Type: `PlatformOS`.',
        },
        {
          name: "isIOS()",
          type: "() => boolean",
          description:
            "iPhone, iPod or iPad, including an iPad that reports itself as a Mac with a touch screen.",
        },
        {
          name: "getOSVersion()",
          type: "() => string | null",
          description:
            '`"18.4"`, `"14"`. Parsed from the user agent, so it is synchronous. `null` on desktop. For the native plugin\'s full record use `getDeviceInfo()` from [capabilities](/docs/capabilities).',
        },
        {
          name: "isOSVersionAtLeast(major, minor?)",
          type: "(major: number, minor?: number) => boolean",
          default: "minor = 0",
          description:
            'Whether the OS version is at or above `major.minor`. `false` when the version is unknown, so a workaround gated on "broken below X" still applies on an unknown OS.',
        },
      ],
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
      text: 'All of these return `false`, `"web"` or `null` on the server. Calling one during render and branching markup on it causes a hydration mismatch on a server-rendered page. Read it in an effect, as above, or style the difference in CSS: the `app:` and `web:` Tailwind variants and the `data-adaptv-platform` and `data-adaptv-os` attributes on `<html>` are set before first paint and cost no render. See [styling](/docs/styling) and [rendering](/docs/rendering).',
    },
    {
      type: "targets",
      rows: [
        {
          target: "Desktop web",
          status: "yes",
          note: '`"web"` shell, `"web"` OS.',
        },
        {
          target: "Mobile web",
          status: "yes",
          note: '`"web"` shell, `"ios"` or `"android"` OS.',
        },
        {
          target: "Installed PWA",
          status: "yes",
          note: '`"standalone"` shell. `isInstalledApp()` is `true`, `isNativePlatform()` is `false`.',
        },
        { target: "iOS", status: "yes", note: '`"native"` shell, `"ios"` OS.' },
        {
          target: "Android",
          status: "yes",
          note: '`"native"` shell, `"android"` OS.',
        },
      ],
    },

    { type: "h2", text: "EasingBezier" },
    {
      type: "api",
      name: "EasingBezier",
      signature: "type EasingBezier = [number, number, number, number]",
      description:
        "A cubic-bezier curve as `[x1, y1, x2, y2]`, the same four numbers CSS `cubic-bezier()` takes. It is the type of the `easing` option of `useChromeTint` in [device hooks](/docs/hooks-device). Exported so a curve shared between a sheet and the toolbar tint can have a named type.",
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
      text: "The entry also exports the functions the app shell and the [Vite plugin](/docs/vite-plugin) use to stamp `<html>` before first paint. They are listed so the export list is complete; an app built on the shell does not call them.",
    },
    {
      type: "props",
      rows: [
        {
          name: "getPlatformInitScript(ui?)",
          type: "(ui?: AdaptvUiConfig) => string",
          description:
            "The blocking `<head>` script as a string. It sets `data-adaptv-platform`, `data-adaptv-os` and one attribute per `ui` option that resolves to on.",
        },
        {
          name: "applyPlatformStamp(ui?)",
          type: "(ui?: AdaptvUiConfig) => void",
          description:
            "Re-apply the same attributes from a layout effect, because React drops script-set attributes when it reconciles `<html>` on the client. Pass the app's `ui` config, or the defaults are used.",
        },
        {
          name: "UI_STAMPS",
          type: "readonly [configKey, attribute][]",
          description:
            "The `ui` options and the attribute each one sets: `noSelect` sets `data-adaptv-no-select`, `hideScrollbars` sets `data-adaptv-hide-scrollbars`, `touchCallout` sets `data-adaptv-no-touch-callout`.",
        },
        {
          name: "normalizeUiScope(value, key?)",
          type: '(value: unknown, key?: keyof AdaptvUiConfig) => "app" | "all" | "off"',
          description:
            'Coerce a config value to a scope. Anything unrecognised becomes that option\'s default: `"app"` for `noSelect` and `touchCallout`, `"all"` for `hideScrollbars`.',
        },
        {
          name: "resolveUiStamp(scope, platform)",
          type: "(scope: UiPatchScope, platform: PlatformTag) => boolean",
          description:
            'Whether a scope is on for a shell. `"all"` is always on, `"off"` never, `"app"` on for `"standalone"` and `"native"`.',
        },
      ],
    },
    {
      type: "p",
      text: "The `ui` options themselves are documented in [config](/docs/config).",
    },
  ],
}
