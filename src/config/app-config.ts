import type { NotFoundRouteComponent } from "@tanstack/react-router"
import type { ComponentType, ReactNode } from "react"
import type {
  OrientationGuardProps,
  OrientationLock,
  SplashScreenProps,
} from "#nativ/config/types"
import type { UiThemePreference } from "#nativ/hooks/use-theme"
import type { UiOpenGraphConfig, UiTwitterConfig } from "#nativ/shell/head"

/* =============================================================================
 * TYPES
 * ============================================================================= */

/**
 * A screen reference for `nativ.config.ts` — a thunk around a literal dynamic
 * import: `splashScreen: () => import("@/components/splash-screen")`.
 *
 * The thunk is NEVER executed at build time. The nativ vite plugin extracts the
 * literal specifier and emits a static import in the generated root, so the
 * screen loads synchronously at first paint (no lazy chunk). The referenced
 * module must have a matching `default` export.
 */
export type ScreenThunk<Props> = () => Promise<{
  default: ComponentType<Props>
}>

/**
 * Native-feel WebKit fixes nativ applies app-wide. **Every one defaults to
 * `true`** — set a field to `false` only to opt out of that specific fix.
 */
export type NativPatches = {
  /**
   * Repaint a focused input's caret when it moves (scroll / drawer / keyboard)
   * so iOS never leaves a detached "ghost" caret behind. Default `true`.
   */
  caretRepaint?: boolean
  /**
   * Suppress the iOS double-tap text-magnifier loupe (WebKit bug 231161 — not
   * fixable in CSS). Default `true`.
   */
  textMagnifier?: boolean
  /**
   * Hold an app-wide scroll + virtual-keyboard-overlay lock so the on-screen
   * keyboard / URL bar can't shift the layout — you own keyboard avoidance for
   * inputs outside an overlay (wrap them in `<AvoidKeyboard>`). Default `true`.
   */
  viewportFreeze?: boolean
  /**
   * Watch the frame rate and promote animating layers to their own GPU layer
   * when frames drop, then release on recovery. Default `true`.
   */
  gpuBoost?: boolean
}

/**
 * The `router` block in `nativ.config.ts` — the one place all routing wiring lives:
 * the rendering mode, the build-time route-generator paths, AND any runtime
 * `createRouter` option. nativ routes each key it recognizes to the right TanStack
 * Start layer; every other key is spread into the generated `createRouter`. The
 * generator paths are required — no magic codebase-specific directories. (The client
 * entry is nativ-generated — no config; eject by writing `src/client.tsx`.)
 */
export type NativRouterConfig = {
  /** Rendering mode. Default `"spa"` (prerender a static shell + hydrate); `"ssr"` server-renders each route. */
  render?: "spa" | "ssr"
  /** Server entry (relative to the app root) for `render: "ssr"`. Optional — Start's built-in is used otherwise. */
  serverEntry?: string
  /** Generated route-tree file, relative to the app root (e.g. `"./routing/routeTree.gen.ts"`). */
  generatedRouteTree: string
  /** Routes directory, relative to the app root (e.g. `"./routing"`). */
  routesDirectory: string
  /** Virtual route-config module — the `rootRoute([...])` DSL (e.g. `"./src/routing/config.ts"`). */
  virtualRouteConfig: string
  /** Quote style for generated code. Default `"double"`. */
  quoteStyle?: "single" | "double"
  /**
   * When the app runs installed / standalone (home-screen PWA), use in-memory
   * router history instead of browser history. The OS edge-swipe-back then has
   * no browser-history entry to navigate, so it's inert and navigation stays
   * app-controlled. In a normal browser tab this is ignored (browser history is
   * kept). **Default `false`** — overriding history is a real behavior change,
   * so opt in explicitly with `true`. Runtime `createRouter`.
   */
  memoryHistoryInStandalone?: boolean
} & Record<string, unknown>

/** `router` keys nativ consumes itself (render / entries / generator paths) — never spread into `createRouter`. */
export const ROUTER_BUILD_KEYS = [
  "render",
  "serverEntry",
  "generatedRouteTree",
  "routesDirectory",
  "virtualRouteConfig",
  "quoteStyle",
] as const

/**
 * Brand background per theme. Provide `light`, `dark`, or both. When only one is
 * given it is used for BOTH appearances — the `theme-color` meta and the
 * launch-gap background stay that single color regardless of light/dark.
 */
export type NativThemeColor =
  | { light: string; dark?: string }
  | { light?: string; dark: string }

/**
 * How the native OS launch-splash mask colour is chosen:
 * - `"preferences"` (default) — follow the app's `useTheme` preference (the device
 *   system when the user hasn't chosen, else their explicit pick).
 * - `"system"` — always follow the device system appearance, ignoring the app pick.
 * - `"light"` / `"dark"` — a fixed colour, independent of theme + system.
 */
export type SplashMaskMode = "preferences" | "system" | "light" | "dark"

export type NativAppConfig = {
  /** App name — manifest `name`, and the head `<title>` unless `title` overrides. */
  name: string
  /** Manifest `short_name` (home-screen label). Default: `name`. */
  shortName?: string
  /** Head `<title>` override. Default: `name`. */
  title?: string
  /** One-line description — head meta + manifest `description`. */
  description: string
  /** Document language (`<html lang>`). Default: `"en"`. */
  lang?: string
  /**
   * Brand background per theme — the launch-gap background, the pre-paint script,
   * and the `theme-color` meta all use EXACTLY these values. Provide `light`,
   * `dark`, or both; a missing side falls back to the other (single-color app).
   */
  themeColor: NativThemeColor
  /**
   * Manifest `background_color` — the backdrop the OS paints behind an installed
   * PWA while it cold-starts. Default: the resolved light theme color. Only set
   * this if the boot backdrop should differ from the light theme background.
   */
  backgroundColor?: string
  /**
   * Public directory holding the icon files. Default: `"./public/favicons"`.
   * Manifest icons are the `android-*` files; sizes are parsed from filenames
   * (`android-icon-36x36.png`, `android-chrome-192.png`).
   */
  icons?: string
  /** Manifest orientation lock; also drives the runtime rotate guard. */
  orientation?: OrientationLock
  /**
   * Allow pinch-zoom. Default `false` for a fixed, native-feeling scale (also
   * kills Safari's focus-zoom on sub-16px inputs). Set `true` to restore
   * pinch-zoom — the WCAG 1.4.4 accessible choice.
   */
  allowZoom?: boolean
  /** App stylesheet entry (e.g. `"./src/styles/main.css"`) — built and linked in the head. */
  styles: string
  /**
   * Service worker entry — app-authored for full flexibility. Default
   * `"./src/sw.ts"`. Pass `false` to ship without a service worker. nativ only
   * bundles it, injects the precache manifest, and provides the derived
   * `__NATIV_BUILD_TAG__` constant.
   */
  sw?: string | false
  /** Extra fields merged verbatim into the generated web manifest. */
  manifestExtra?: Record<string, unknown>

  /** Open Graph meta. */
  openGraph?: UiOpenGraphConfig
  /** Twitter card meta. */
  twitter?: UiTwitterConfig
  /** Initial theme when the user has no saved preference. Default: `"system"`. */
  defaultThemePreference?: UiThemePreference
  /** Toggle nativ's native-feel WebKit fixes. All default `true`; opt out per fix. */
  patches?: NativPatches

  /**
   * Native (Capacitor) app id, reverse-domain (e.g. `"com.chopchop.app"`). Setting it
   * enables native iOS/Android builds — nativ generates the entire Capacitor project
   * from this one field; you never touch a Capacitor config. Web-only apps omit it.
   */
  appId?: string
  /** Native display name (home-screen label on device). Default: `name`. */
  appName?: string

  /**
   * Boot splash overlay — your own React component. nativ renders it while the app is
   * **installed** (native app or home-screen PWA); it **self-dismisses by returning
   * `null`** when ready (no `hide` prop). A browser tab gets the page instantly with no
   * splash unless {@link splashScreenInBrowser}. The OS launch splash is a flat mask
   * colour ({@link splashMaskMode}) that hands off to this overlay without flicker.
   */
  splashScreen?: ScreenThunk<SplashScreenProps>
  /** Also show {@link splashScreen} in a browser tab. Default `false` (installed-only). */
  splashScreenInBrowser?: boolean
  /**
   * How the OS launch-splash mask colour is chosen. Default `"preferences"` (follows
   * the app theme). See {@link SplashMaskMode}.
   */
  splashMaskMode?: SplashMaskMode
  /** Launch mask colour (light). Default: {@link backgroundColor} ?? the light theme colour. */
  splashMaskLightColor?: string
  /** Launch mask colour (dark). Default: the dark theme colour. */
  splashMaskDarkColor?: string

  /** Full-screen prompt shown when a touch device is rotated against the orientation lock. */
  orientationGuardScreen?: ScreenThunk<OrientationGuardProps>
  /** Full-screen 404. */
  notFoundScreen?: () => Promise<{ default: NotFoundRouteComponent }>
  /** App-wide provider tree, mounted by the shell around the router outlet. */
  providers?: ScreenThunk<{ children: ReactNode }>

  /**
   * Router config — one block for all routing wiring: rendering mode + bundle
   * entries, build-time route-generator paths, and any runtime `createRouter`
   * option. See {@link NativRouterConfig}.
   */
  router: NativRouterConfig
}

/* =============================================================================
 * DEFINE
 * ============================================================================= */

/** Identity helper for `nativ.config.ts` — full typing + a stable anchor for tooling. */
export function defineApp<const T extends NativAppConfig>(config: T): T {
  return config
}

/**
 * Resolve a (possibly partial) {@link NativThemeColor} to concrete light + dark
 * colors. A missing side falls back to the provided one — a single-color app uses
 * that one color for both appearances (meta + launch-gap background).
 */
export function resolveThemeColors(themeColor: NativThemeColor): {
  light: string
  dark: string
} {
  const light = themeColor.light ?? themeColor.dark
  const dark = themeColor.dark ?? themeColor.light
  if (!light || !dark) {
    throw new Error(
      "nativ.config.ts: `themeColor` needs at least one of `light` / `dark`.",
    )
  }
  return { light, dark }
}
