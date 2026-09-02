import type { NotFoundRouteComponent } from "@tanstack/react-router"
import type { ComponentType } from "react"
import type { UiThemePreference } from "#adaptv/capabilities/native-theme"
import type { BootErrorProps } from "#adaptv/components/boot-error"
import type { OfflineProps } from "#adaptv/components/offline"
import type {
  OrientationGuardProps,
  OrientationLock,
  SplashScreenProps,
  UpdateRequiredProps,
} from "#adaptv/config/types"
import type { AdaptvPrivacyConfig } from "#adaptv/native/privacy-manifest"
import type {
  UiOpenGraphConfig,
  UiTwitterConfig,
} from "#adaptv/shell/head"

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
 * When a waiting service worker is applied. → `serviceWorkerUpdate`
 *
 * Two values, not four. There is no `"immediate"`: applying mid-session prunes
 * the previous build's precache out from under a live module graph, so the next
 * lazy route import 404s at both cache and origin — and the reload that follows
 * takes unsaved state with it. And there is no `"off"`: a worker that never
 * activates pins the app to the build it first saw, forever.
 */
export type ServiceWorkerUpdatePolicy = "auto" | "prompt"

/**
 * How far one of the *questionable* app-feel resets reaches.
 *
 * - `"app"` — installed PWA + native only.
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
 * *is*, not on correctness. Per-option defaults, because the options do not share a
 * right answer (`utils/platform.ts`: `UI_SCOPE_DEFAULTS`).
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
   * reset. Default `"all"` — the one option that is stricter than `"app"`, because
   * it is the one with a per-scroller escape: `ScrollView`'s
   * `showsVerticalScrollIndicator` emits `scrollbar-visible`, which outranks this
   * reset, so a scroller that genuinely wants a desktop scroll-position indicator
   * asks for one. That escape is what lets the same code feel the same on all six
   * targets without stranding a desktop user.
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
 * the SSR server entry, the build-time route-generator paths, AND any runtime
 * `createRouter` option. adaptv routes each key it recognizes to the right TanStack
 * Start layer; every other key is spread into the generated `createRouter`. The
 * generator paths are required — no magic codebase-specific directories. (The client
 * entry is adaptv-generated — no config; eject by writing `src/client.tsx`.)
 */
export type AdaptvRouterConfig = {
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

/**
 * `router` keys adaptv consumes itself (entries / generator paths) — never spread
 * into `createRouter`.
 *
 * `"render"` used to head this list, back when the render mode was `router.render`.
 * It is a **top-level** `render` key now (`docs/decisions/rendering-and-delivery.md §1`,
 * renamed 2026-08-09), so filtering it out of the `router` block guarded a shape that
 * no longer exists — and adaptv carries no compatibility shims.
 */
export const ROUTER_BUILD_KEYS = [
  "serverEntry",
  "routesDirectory",
  "routerConfig",
] as const

/** Brand background per theme. See {@link resolveThemeColors} for the one-sided case. */
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
   * There is **no default directory** — name one and adaptv reads it. `./public/favicons` is
   * the conventional place to put it, not a path adaptv looks in on its own: a fallback that
   * resolved to a real directory made this key look ignored, because removing it changed
   * nothing.
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
   * **Your** service-worker modules, run inside adaptv's worker.
   *
   * There is no option to disable, replace or retune adaptv's own worker, and
   * that is the point: precaching every route chunk is what makes a web build
   * navigate like the native one, and an app that opts out of it silently stops
   * being the product. adaptv registers exactly one worker, always, on web and
   * standalone — never on Capacitor (§3.5).
   *
   * What this list adds is app behaviour the framework has no opinion about —
   * push handlers, background sync, a runtime cache for your own API. Each file
   * is bundled into adaptv's worker and evaluated **after** its setup, so it can
   * add handlers but cannot take over precaching or navigation: Workbox matches
   * routes in registration order, and adaptv registers first.
   *
   * ```ts
   * serviceWorkers: ["./src/sw/push.ts"]
   * ```
   *
   * Write them against `@arrzdev/adaptv/sw` (`sendToApp`, `onAppMessage`,
   * `cacheRoute`); the app side reads them with `useServiceWorkerMessage()`. You
   * never write registration code — adaptv owns that end to end.
   */
  serviceWorkers?: string[]
  /**
   * When a new build's worker is applied. Default `"auto"`. → `docs/design/rendering.md §3.4`
   *
   * | value | behaviour |
   * |---|---|
   * | `"auto"` | applied at **cold launch**, invisibly. No UI, no prompt, no API. |
   * | `"prompt"` | never applied on its own — the app decides, via `useServiceWorkerUpdate()`. |
   *
   * **One setting, because there is one worker.** The modules in
   * `serviceWorkers: []` are bundled into adaptv's own and share its single
   * registration, so there is no such thing as updating the app's half while the
   * framework's half waits: the whole worker activates, or none of it does.
   *
   * `"auto"` is the default and is what most apps want. The waiting worker
   * finished installing in an *earlier* session, so applying it costs one reload
   * and zero downloads, and a document created moments ago has no typed-in form
   * or in-flight upload to destroy. Nothing is ever applied mid-session.
   *
   * Choose `"prompt"` when a session can hold state that outlives a reload and
   * the app would rather ask — an editor, a long form, a call. Then:
   *
   * ```tsx
   * const { updateAvailable, applyUpdate } = useServiceWorkerUpdate()
   * if (updateAvailable) return <Banner onClick={applyUpdate}>New version ready</Banner>
   * ```
   *
   * The UI is entirely yours — adaptv ships no update prompt, so it renders in
   * your design system, with your theme and safe areas.
   */
  serviceWorkerUpdate?: ServiceWorkerUpdatePolicy
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
   * scrollbar visibility, and the iOS link callout. Selection and the callout
   * default to `"app"` (installed PWA + native only); scrollbars default to
   * `"all"`. See {@link AdaptvUiConfig}.
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
   * What only your app can know about its privacy manifest (`PrivacyInfo.xcprivacy`).
   *
   * adaptv generates the manifest on every iOS build and derives the required-reason
   * APIs of every plugin compiled in — its own bundled set included, which is most
   * apps' entire obligation. This is for the rest: an unlisted plugin's APIs, and the
   * declarations Apple expects from the app itself (tracking, collected data). Since
   * the file is generated, this is the only place to put them.
   *
   * @example privacy: { collectedData: [{ type: "NSPrivacyCollectedDataTypeEmailAddress", linked: true, tracking: false, purposes: ["NSPrivacyCollectedDataTypePurposeAppFunctionality"] }] }
   */
  privacy?: AdaptvPrivacyConfig

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
   *
   * It is mounted and painted **underneath** the OS launch splash — that overlap is what
   * makes the handoff seamless — so it is handed `revealedAt`, the moment it actually went
   * on screen. Time a minimum visible duration from that and never from mount.
   * → {@link SplashScreenProps}
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
  /**
   * How many days the channel may have been **ahead of this app's native layer**
   * before adaptv takes the screen. Omit it — the default — and adaptv never does.
   *
   * It goes ahead when a published build is made against a different set of
   * native plugins than the installed binary has, and from then on only a store
   * update brings the two back into line. → `docs/design/ota.md §5.6`
   *
   * 🔴 **That install is working, so blocking it has a real cost.** It is taking
   * every bundle the channel publishes (or, under
   * {@link AdaptvAppConfig.otaOnNativeSkew} `"refuse"`, sitting on the last one
   * that matched), still checking, still covered by the rollback watchdog — with
   * the features that need the missing native code reporting unavailable. Set
   * this only when a *server* contract moved with the native release: an API, a
   * data shape, an auth flow now built for a version this install will never
   * reach. adaptv cannot see that from the device, which is why it will not guess
   * a number for you.
   *
   * A number rather than a switch, because the channel moves when a release is
   * **built** — usually before review lets anyone install it. `0` blocks the
   * moment that happens, which is right when the contract broke with the release
   * and hostile when it did not. Something like `14` lets the store catch up and
   * only interrupts the installs that really were left behind.
   *
   * For anything short of taking the screen — a banner, a badge, a nag — read the
   * same state directly with `useStoreRelease()` and render what you like.
   */
  updateRequiredAfterDays?: number
  /**
   * Your own screen for {@link updateRequiredAfterDays}, instead of adaptv's.
   *
   * Receives the age in whole days, the timestamp it started, and the build tag
   * this install refused. adaptv's default deliberately states the age and never
   * promises the new version is downloadable yet, for the reason above; if you
   * know your release is out, say so here.
   */
  updateRequiredScreen?: ScreenThunk<UpdateRequiredProps>
  /** Full-screen 404. */
  notFoundScreen?: () => Promise<{ default: NotFoundRouteComponent }>
  /**
   * The app's offline UI. **One component, two call sites** — adaptv renders it
   * when the app can't boot far enough for a route to exist (a route chunk fails
   * to load, or the route tree can't resolve), and the consumer renders the *same*
   * component from a route whose data is unavailable. Every prop is optional,
   * which is what lets one component serve both. → `docs/design/rendering.md §3.1.2`
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
   * → `docs/design/rendering.md §3.1.3`
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
   * The app's public origin — e.g. `"https://app.acme.com"`. Origin only: no
   * path, no trailing slash, and `https` outside localhost.
   *
   * The `https` part is **enforced at build time**, not advised: both mobile
   * platforms block cleartext, so an http origin makes the update check fail
   * inside the network stack, which the updater cannot tell apart from being
   * offline. Every install would stay on its store version with nothing logged.
   *
   * **This is where installed native apps look for their own updates.** The
   * ordinary web build writes an OTA channel under
   * `<origin>/.well-known/adaptv/ota/`, the deploy carries it, and every install
   * polls it on launch and resume. → `docs/design/ota.md §5.2`
   *
   * ⚠︎ **Treat it as permanent, like the bundle ID.** It is baked into the store
   * binary, so changing it takes a store release — and every install that never
   * takes that release keeps asking the old origin forever. Those users are not
   * broken, they are *frozen*: still running, never updating again, and silent
   * about it. Moving a domain is therefore a migration, not a config edit.
   *
   * Omit it and OTA is simply off: the channel is not emitted and the app never
   * checks. Everything else — web, PWA, the native build itself — is unaffected.
   * `ADAPTV_OTA_ORIGIN` overrides it for local verification.
   */
  origin?: string
  /**
   * The public half of the app's OTA signing key — a PEM SPKI RSA public key.
   *
   * **Committed on purpose.** A public key is not a secret, and this one has to
   * be in the repository because it is baked into the store binary at build time,
   * on machines that must never see the private half. Generate the pair with
   * `adaptv keys ota`; keep the private key as a CI secret and pass it as
   * `ADAPTV_OTA_PRIVATE_KEY` to whatever runs `adaptv build web`.
   *
   * ⚠︎ **As permanent as {@link AdaptvAppConfig.origin}, and more unforgiving.** It can only
   * change through a store release, so losing the private key means no install
   * can be updated again until every user takes a new one from the store. Back it
   * up the way you back up a signing certificate.
   *
   * Omit it and the build refuses to publish a channel, because an unsigned
   * channel is a remote-code-execution channel into every installed app.
   * `ADAPTV_OTA_ALLOW_UNSIGNED=1` (with `ADAPTV_OTA_ORIGIN`) is the local-only
   * escape hatch. → `docs/design/ota.md §5.4d`
   *
   * To verify a signed channel locally without holding the production private
   * key, override this with `ADAPTV_OTA_PUBLIC_KEY` (also only alongside
   * `ADAPTV_OTA_ORIGIN`) and build against a throwaway pair.
   */
  otaPublicKey?: string
  /**
   * What an installed app does with an update built against a **different set of
   * native plugins** than it has. Default `"install"`. → `docs/design/ota.md §5.6`
   *
   * A native change ships through the store; everything else ships over the air.
   * The two get out of step whenever a release adds a plugin, because the bundle
   * is on every device the day it is published and the binary takes as long as
   * review plus whenever the user updates.
   *
   * - `"install"` — take it. Bug fixes, copy, layout, the whole rest of that
   *   release lands on every install immediately, and the parts that need the
   *   missing native code report themselves unavailable through adaptv's own
   *   capability hooks — `useShare().supported` and its peers. **Ask before you
   *   call**: a native call is a rejected promise on an app that does not have it.
   * - `"refuse"` — leave the install on its last matching bundle until a store
   *   release moves it. Choose this when the release changed a contract the JS
   *   cannot route around — a server API, an auth flow, a data shape — so a
   *   half-working bundle would be worse than a stale one.
   *
   * Either way `useStoreRelease()` reports that the channel has moved past this
   * app, and {@link AdaptvAppConfig.updateRequiredAfterDays} can take the screen
   * once it has been true for long enough.
   */
  otaOnNativeSkew?: "install" | "refuse"

  /**
   * How often an installed app looks for a new bundle **while it is being used**,
   * in whole minutes. Default `60`. `0` turns the poll off. → `docs/design/ota.md §5.2`
   *
   * It is a third check, not the only one: adaptv already looks on every launch
   * and on every resume, and resume is the one that carries a phone. A poll only
   * changes the session that never goes to the background — a kiosk, a tablet on
   * a wall, an app someone works in all afternoon — where the other two never
   * fire and the install can sit a full day behind its own web deploy.
   *
   * ⚠︎ **It changes when the download happens, never when the swap does.** The
   * bundle is still applied at the next cold start, because replacing the
   * WebView's root under a live app tears its state (`docs/design/ota.md §5.4b`). What
   * it buys is that the next cold start has the bundle *already staged*, so the
   * update appears on the very next launch instead of the one after it.
   *
   * A number rather than a switch, because the right interval is a function of
   * how often you deploy, and that is the one thing adaptv cannot see from
   * inside the app. The default assumes a team that ships a few times a day; an
   * app that deploys twice a year should say `0` and rely on resume.
   *
   * The minimum is 5. A smaller number is almost always someone writing seconds,
   * and the build says so rather than quietly polling twelve times a minute.
   */
  otaPollMinutes?: number

  /**
   * How the **web** build renders. **Defaults to `"ssr"`.**
   *
   * - `"ssr"` — a server renders the HTML for each request, then the client
   *   hydrates it. Every route arrives as real markup, so crawlers and link
   *   previews see the page without running JavaScript.
   * - `"spa"` — no per-request render. The host serves one static shell, the
   *   client router resolves the URL, and React draws the page.
   *
   * There is no native equivalent to choose: a Capacitor WebView loads files off
   * the device, so it is always a static SPA. This key is only about the web.
   *
   * **What it really decides is what your deploy needs.** `"ssr"` requires
   * something that runs your server on every request — a Node process, a
   * Cloudflare Worker, a Vercel function. `"spa"` needs nothing but a place to put
   * files, so it is what makes GitHub Pages, Netlify, an S3 bucket or any CDN a
   * valid target. Pick the render mode you want and let it tell you where you can
   * deploy, rather than the other way round.
   *
   * **This is the only deploy-shaping key, and there is deliberately no `host`.**
   * The single thing adaptv needs to know is whether a server answers the request,
   * which is exactly what this key says; *which* server is a question adaptv has no
   * behaviour behind — a `"cloudflare"` build and a `"node"` build were byte-for-byte
   * identical when that key existed. Naming the target belongs to the deploy layer:
   * one Vite plugin in `vite.config.ts`, and `NITRO_PRESET` for pipelines that
   * switch target per environment. → `docs/decisions/rendering-and-delivery.md §2`
   *
   * The `"ssr"` default is an asymmetry argument, not a performance one: a wrong
   * SPA default silently kills SEO and is discovered late, by someone reading a
   * ranking report. A wrong SSR default costs one config flip, immediately, by the
   * person who wanted SPA. → `docs/decisions/rendering-and-delivery.md §1`
   */
  render?: "ssr" | "spa"

  /**
   * Router config — one block for all routing wiring: the SSR server entry,
   * build-time route-generator paths, and any runtime `createRouter`
   * option. See {@link AdaptvRouterConfig}.
   */
  router: AdaptvRouterConfig
}

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
