import type { NotFoundRouteComponent } from "@tanstack/react-router"
import type { ComponentType } from "react"
import type { BootErrorProps } from "#adaptv/components/boot-error"
import type { OfflineProps } from "#adaptv/components/offline"
import type {
  OrientationGuardProps,
  OrientationLock,
  SplashScreenProps,
} from "#adaptv/config/types"
import type { UiThemePreference } from "#adaptv/hooks/use-theme"
import type {
  UiOpenGraphConfig,
  UiTwitterConfig,
} from "#adaptv/shell/head"

/* =============================================================================
 * TYPES
 * ============================================================================= */

/**
 * A screen reference for `adaptv.config.ts` — a thunk around a literal dynamic
 * import: `splashScreen: () => import("@/components/splash-screen")`.
 *
 * The thunk is NEVER executed at build time. The adaptv vite plugin extracts the
 * literal specifier and emits a static import in the generated root, so the
 * screen loads synchronously at first paint (no lazy chunk). The referenced
 * module must have a matching `default` export.
 */
export type ScreenThunk<Props> = () => Promise<{
  default: ComponentType<Props>
}>

/**
 * Native-feel WebKit fixes adaptv applies app-wide. **Every one defaults to
 * `true`** — set a field to `false` only to opt out of that specific fix.
 */
export type AdaptvPatches = {
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
}

/**
 * How far one of the *questionable* app-feel resets reaches.
 *
 * - `"app"` — installed PWA + native only (the default for every option).
 * - `"all"` — every target, browser tab included.
 * - `"off"` — adaptv does not touch the property at all.
 *
 * Only the resets whose alternative is **different, not broken**, are configurable.
 * The hover-stickiness fix, the `touch-action` longhand (WebKit 240917), the caret
 * mute, the autofill cover and the safe-area `env()` ordering (crbug/40699457) have
 * no knob and never will — nobody has a legitimate reason to want the broken
 * behaviour, so a flag there would only be a way to break the app.
 */
export type UiPatchScope = "app" | "all" | "off"

/**
 * The `ui` block — the app-feel resets whose right answer depends on what the app
 * *is*, not on correctness. All default to `"app"`, so an installed app keeps the
 * native feel while a browser tab keeps browser behaviour.
 *
 * Resolved **once**, in the pre-paint init script, against the runtime platform;
 * the result is a boolean-presence attribute on `<html>`. So `styles.css` stays a
 * single static artifact — there is no per-config CSS and no build matrix.
 */
export type AdaptvUiConfig = {
  /**
   * The global `user-select: none` reset. Default `"app"`.
   *
   * `"all"` is hostile in a real browser tab: the user cannot select an error
   * message, cannot `Ctrl+A`, cannot copy a code snippet. Text-editing surfaces
   * (`input`, `textarea`, `[contenteditable="true"]`) always keep native selection
   * whatever this is set to, and any element can opt back in with the `selectable`
   * utility.
   */
  noSelect?: UiPatchScope
  /**
   * The global `scrollbar-width: none` + `::-webkit-scrollbar { display: none }`
   * reset. Default `"all"`.
   *
   * The earlier default was `"app"`, on the reasoning that a desktop user loses the
   * scroll-position indicator. That reasoning assumed the consumer had no recourse —
   * they do: `ScrollView`'s `showsVerticalScrollIndicator` emits `scrollbar-visible`,
   * which outranks this reset, so a scroller that genuinely wants an indicator asks
   * for one. With a working per-scroller escape, defaulting to off everywhere is what
   * makes the same code feel the same on all six targets.
   */
  hideScrollbars?: UiPatchScope
  /**
   * The `a[href] { -webkit-touch-callout: none }` reset — iOS's long-press link
   * preview sheet. Default `"app"`.
   *
   * Same shape as {@link noSelect}: in an installed app the sheet is a browser
   * artefact leaking through (and it fights any long-press gesture the app owns),
   * but in an iOS Safari tab it is a real affordance the user expects — long-press
   * a link to copy it or open it in a new tab. `"all"` takes that away.
   *
   * ⚠︎ Only the callout is configurable. The `-webkit-tap-highlight-color:
   * transparent` half of the same rule stays universal: the grey flash is a
   * duplicate of the press feedback adaptv already draws, and nobody wants both.
   */
  touchCallout?: UiPatchScope
}

/**
 * The build-time image pipeline, behind `?adaptv-image`.
 *
 * ⚠︎ There is deliberately **no switch for the dimensions.** `width`/`height` are
 * the whole anti-layout-shift mechanism (`VISION.md §2.1`), so a build that cannot
 * resolve them errors rather than degrading — that is doctrine, not preference, and
 * a knob for it would be a knob for shipping layout shift.
 */
export type AdaptvImagesConfig = {
  /**
   * Generate the blurred low-resolution placeholder. Default `true`.
   *
   * Turning it off still resolves `width`/`height`, so the box is still reserved and
   * nothing shifts — you lose the blur, not the guarantee. Worth it for an app whose
   * images are mostly flat colour or line art, where a 16px blur reads as a grey
   * smear rather than a preview, and for shaving the per-image build cost.
   *
   * A caller can still pass a `placeholder` data URL per `<Image>` with this off.
   */
  placeholder?: boolean
}

/**
 * The `router` block in `adaptv.config.ts` — the one place all routing wiring lives:
 * the rendering mode, the build-time route-generator paths, AND any runtime
 * `createRouter` option. adaptv routes each key it recognizes to the right TanStack
 * Start layer; every other key is spread into the generated `createRouter`. The
 * generator paths are required — no magic codebase-specific directories. (The client
 * entry is adaptv-generated — no config; eject by writing `src/client.tsx`.)
 */
export type AdaptvRouterConfig = {
  /** Rendering mode. Default `"spa"` (prerender a static shell + hydrate); `"ssr"` server-renders each route. */
  render?: "spa" | "ssr"
  /** Server entry (relative to the app root) for `render: "ssr"`. Optional — Start's built-in is used otherwise. */
  serverEntry?: string
  /**
   * Where the app's route files live, relative to `src/`. **Default
   * `"./routing"`** (i.e. `src/routing`). Only set this if your routes live
   * somewhere else — it exists because a routes folder is genuinely the app
   * author's to place, not because adaptv needs you to declare a default.
   */
  routesDirectory?: string
  /**
   * The app's route config — the `rootRoute([...])` DSL. **Default
   * `"./src/routing/config.ts"`.**
   *
   * Named `routerConfig`, not `virtualRouteConfig`: adaptv **always** uses the
   * declarative route config. It is the framework's opinion, not a mode the
   * consumer selects, so the name should not leak the underlying TanStack
   * "virtual file routes" implementation detail.
   */
  routerConfig?: string
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

/** `router` keys adaptv consumes itself (render / entries / generator paths) — never spread into `createRouter`. */
export const ROUTER_BUILD_KEYS = [
  "render",
  "serverEntry",
  "routesDirectory",
  "routerConfig",
] as const

/**
 * Brand background per theme. Provide `light`, `dark`, or both. When only one is
 * given it is used for BOTH appearances — the `theme-color` meta and the
 * launch-gap background stay that single color regardless of light/dark.
 */
export type AdaptvThemeColor =
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

/** Object form of `sw` — the entry plus service-worker build options. */
export type AdaptvSwOptions = {
  /** App-relative entry path. Default `"./src/sw.ts"`. */
  entry?: string
  /**
   * **Public, user-agnostic routes only** — precached as documents so they
   * cold-load instantly and work offline. Empty by default, and that default is a
   * safety property: Cache Storage is keyed by URL and scoped per-ORIGIN, not
   * per-user, so precaching a personalized document serves one user's HTML to the
   * next. → `RENDERING.md §3.2`
   */
  precacheDocuments?: string[]
}

/** The `web` deployment block — intent-level. → `LIFECYCLE.md §1.2` */
export type AdaptvWebConfig = {
  /**
   * Rendering mode. **Defaults to `"ssr"`.**
   *
   * The default is an asymmetry argument, not a performance one: a wrong SPA
   * default silently kills SEO and is discovered late, by someone reading a
   * ranking report. A wrong SSR default costs one config flip, immediately, by
   * the person who wanted SPA. → `DECISIONS.md §6.3`
   */
  render?: "ssr" | "spa"
  /** Deploy target — maps to a TanStack Start deploy preset. Default `"node"`. */
  host?: "cloudflare" | "vercel" | "node" | "static"
  sw?: {
    /** Default `true`. `false` ships without a service worker. */
    enabled?: boolean
    /**
     * **Public, user-agnostic routes only**, precached as documents. Empty by
     * default — Cache Storage is per-ORIGIN, not per-user, so precaching a
     * personalized document serves one user's HTML to the next.
     */
    precacheDocuments?: string[]
    /** How a waiting worker is applied. Default `"prompt"`. → `RENDERING.md §3.4` */
    register?: "prompt" | "autoUpdate" | "manual"
  }
}

export type AdaptvAppConfig = {
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
  themeColor: AdaptvThemeColor
  /**
   * Manifest `background_color` — the backdrop the OS paints behind an installed
   * PWA while it cold-starts. Default: the resolved light theme color. Only set
   * this if the boot backdrop should differ from the light theme background.
   */
  backgroundColor?: string
  /**
   * The app's icon set — **one directory, every target**. It must live inside `public/` so the
   * files are actually served.
   *
   * There is **no default directory**. Name one and adaptv reads it; name none and the app
   * wears adaptv's own mark, on the home screen and in the manifest alike — never Capacitor's
   * stock icon. `./public/favicons` is the conventional place to put it, not a path adaptv
   * looks in on its own: a fallback that resolved to a real directory made this key look
   * ignored, because removing it changed nothing.
   *
   * Generate it with **`adaptv gen icons --input <image>`** (one png/svg, 1024px+) or drop a
   * standard favicon-generator output in. Either way adaptv reads the directory itself — it **measures
   * every file** rather than trusting the size in its name — and derives all three surfaces:
   *
   * - **Web manifest** — every square icon ≥48px, deduped per size, `android-maskable-*` and
   *   any `*maskable*` file marked `purpose: "maskable"`. `apple-*` and `ms-*` art is
   *   excluded (that is head-linked), and so are 1024px masters, which no browser asks for.
   * - **Head links** — `<link rel=icon>` per size plus the Apple touch icons, for the files
   *   that **exist**. Nothing is linked speculatively.
   * - **Native launcher icons** — the right member per slot: full-bleed art for iOS and for
   *   Android's legacy square, safe-zoned `maskable` art for Android's adaptive foreground.
   *   A lone `icon.png` is a perfectly good set of one.
   * - **iOS 18 appearances** — `icon-dark.png` and `icon-tinted.png` become the Dark and
   *   Tinted slots of the app icon, so the home screen switches with the system instead of
   *   keeping the light icon in all three. `gen icons` writes them; nothing else has to.
   *
   * **No usable art anywhere** — no directory, an empty one, nothing readable — and the app
   * ships **adaptv's own mark** rather than Capacitor's stock icon, on every surface. You are
   * told once per run; `adaptv gen icons --input <image>` is the fix.
   *
   * Beyond that it warns only about what you can act on: a source too small for the platform's
   * largest slot (1024px iOS, 432px Android — it still upscales and builds), an opaque source
   * where Android's adaptive foreground needs transparency, or a set too small to install as
   * a PWA.
   *
   * ⚠︎ Author the source **full-bleed on a flat (or transparent) background**. Every platform
   * applies its own mask — iOS rounds, Android cuts a circle or a squircle — so art that draws
   * its own rounded-square background gets rounded twice.
   *
   * Transparency is **not** required: what `gen icons` needs is to know where the logo *ends*,
   * and a flat colour says that as clearly as alpha does — the mark is lifted off it, re-centred
   * and fitted, and the colour is repainted around it. A gradient or a photo behind the mark
   * can't be separated, so the logo is left where you drew it and the mask takes whatever
   * reaches the edge.
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
   * Service worker. adaptv bundles the entry, injects the precache manifest, and
   * provides the derived `__ADAPTV_BUILD_TAG__` constant.
   *
   * - `string` — the app-authored entry path (default `"./src/sw.ts"`).
   * - `false` — ship without a service worker.
   * - object — the entry plus SW build options, notably `precacheDocuments`.
   *
   * Forced to `false` on the Capacitor target, unconditionally (L12): the bundle
   * is already on-device, iOS cannot register a worker on a custom-scheme origin
   * at all, and a stale worker actively breaks OTA. → `RENDERING.md §3.5`
   */
  sw?: string | false | AdaptvSwOptions
  /** Extra fields merged verbatim into the generated web manifest. */
  manifestExtra?: Record<string, unknown>

  /** Open Graph meta. */
  openGraph?: UiOpenGraphConfig
  /** Twitter card meta. */
  twitter?: UiTwitterConfig
  /** Initial theme when the user has no saved preference. Default: `"system"`. */
  defaultThemePreference?: UiThemePreference
  /** Toggle adaptv's native-feel WebKit fixes. All default `true`; opt out per fix. */
  patches?: AdaptvPatches
  /**
   * The app-feel resets that are genuinely the app's call — text selection,
   * scrollbar visibility, and the iOS link callout. All default to `"app"`
   * (installed PWA + native only). See {@link AdaptvUiConfig}.
   */
  ui?: AdaptvUiConfig
  /**
   * The build-time image pipeline behind `import hero from "./hero.jpg?adaptv-image"`.
   * See {@link AdaptvImagesConfig}.
   */
  images?: AdaptvImagesConfig

  /**
   * Extra Capacitor-compatible native plugins, by package name — **additive** to the
   * base set adaptv ships for its primitives. adaptv is compatible with any Capacitor
   * plugin: `pnpm add` it, list it here, and use its JS API in your code. adaptv wires
   * the native side (iOS pods / Android gradle) into the project it owns — you never
   * touch a Capacitor config or a native project. Per-plugin native settings go in
   * {@link pluginConfig}.
   *
   * @example plugins: ["@capacitor/camera", "@capacitor-community/barcode-scanner"]
   */
  plugins?: string[]
  /**
   * Native runtime settings for plugins, keyed by the plugin's Capacitor class name
   * (e.g. `Camera`, `PushNotifications`) — merged into the generated native config.
   * adaptv sets sensible defaults for the plugins its primitives use; this is for the
   * rest.
   */
  pluginConfig?: Record<string, Record<string, unknown>>

  /**
   * Native (Capacitor) app id, reverse-domain (e.g. `"com.chopchop.app"`). Setting it
   * enables native iOS/Android builds — adaptv generates the entire Capacitor project
   * from this one field; you never touch a Capacitor config. Web-only apps omit it.
   */
  appId?: string
  /** Native display name (home-screen label on device). Default: `name`. */
  appName?: string

  /**
   * Boot splash overlay — your own React component. adaptv renders it while the app is
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
  /**
   * The app's offline UI. **One component, two call sites** — adaptv renders it
   * when the app can't boot far enough for a route to exist (a route chunk fails
   * to load, or the route tree can't resolve), and the consumer renders the *same*
   * component from a route whose data is unavailable. Every prop is optional,
   * which is what lets one component serve both. → `RENDERING.md §3.1.2`
   *
   * ```ts
   * offlineComponent: () => import("@/components/offline")
   * ```
   *
   * ⚠︎ Like every screen thunk, this is **never executed**: the Vite plugin reads
   * the literal specifier and emits a *static* import in the generated root. That
   * is load-bearing here rather than incidental — if this resolved to its own lazy
   * chunk, then in exactly the situation it exists for (chunks unavailable) the
   * chunk carrying the offline UI would be unavailable too, and the user would get
   * a blank screen instead. `stamp.test.ts` guards it.
   *
   * Defaults to adaptv's own `Offline` component.
   */
  offlineComponent?: ScreenThunk<OfflineProps>
  /**
   * The screen shown when the app's **bundle never ran** — a 404 on the entry
   * chunk, a syntax error, a corrupt OTA bundle. The WebView would otherwise be
   * blank, because no app code got to execute at all.
   *
   * ```ts
   * bootErrorScreen: () => import("@/components/boot-error")
   * ```
   *
   * ⚠︎ **Not for runtime errors.** A route that throws, a failed fetch, a bad
   * render — those are the app's to catch, with its own boundary around whatever
   * it wants to protect. adaptv does not install one, deliberately, because it
   * would take that handling away from the app. This slot is only for the case
   * the app never got to have an opinion about.
   *
   * Prerendered to static HTML at build time, since there is no React alive when
   * it is needed. It therefore has to render standalone, from a `code` prop and
   * nothing else — no browser, no hooks. Defaults to adaptv's own `BootError`.
   * → `RENDERING.md §3.1.3`
   */
  bootErrorScreen?: ScreenThunk<BootErrorProps>
  //NOTE: there is deliberately no `providers` field. An app-wide provider tree is
  //just a layout route — declare one in `routerConfig` and wrap `<Outlet />`:
  //
  //  export const routes = rootRoute([
  //    layout("layouts/providers.layout.tsx", [ index("pages/home.tsx") ]),
  //  ])
  //
  //That is the router's own composition model, it nests and scopes properly, and
  //it puts providers where the consumer can see them. A config thunk would be a
  //second, weaker way to express the same thing.

  /**
   * Deployment intent — rendering mode, host, service worker. Prefer this over
   * the lower-level `router.render` / `sw` fields, which remain as escape
   * hatches. → {@link AdaptvWebConfig}
   */
  web?: AdaptvWebConfig

  /**
   * Router config — one block for all routing wiring: rendering mode + bundle
   * entries, build-time route-generator paths, and any runtime `createRouter`
   * option. See {@link AdaptvRouterConfig}.
   */
  router: AdaptvRouterConfig
}

/* =============================================================================
 * DEFINE
 * ============================================================================= */

/** Identity helper for `adaptv.config.ts` — full typing + a stable anchor for tooling. */
export function defineApp<const T extends AdaptvAppConfig>(config: T): T {
  return config
}

/**
 * Resolve a (possibly partial) {@link AdaptvThemeColor} to concrete light + dark
 * colors. A missing side falls back to the provided one — a single-color app uses
 * that one color for both appearances (meta + launch-gap background).
 */
export function resolveThemeColors(themeColor: AdaptvThemeColor): {
  light: string
  dark: string
} {
  const light = themeColor.light ?? themeColor.dark
  const dark = themeColor.dark ?? themeColor.light
  if (!light || !dark) {
    throw new Error(
      "adaptv.config.ts: `themeColor` needs at least one of `light` / `dark`.",
    )
  }
  return { light, dark }
}
