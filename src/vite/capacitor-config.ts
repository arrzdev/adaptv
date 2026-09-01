import type { AdaptvAppConfig } from "#adaptv/config/app-config.ts"
import { BOOT_GRACE_MS } from "#adaptv/shell/boot-fallback.ts"
import { ADAPTV_DIR } from "#adaptv/vite/adaptv-dir.ts"
import {
  resolveOtaOrigin,
  resolveOtaPublicKey,
} from "#adaptv/vite/ota-config-module.ts"

//The Capacitor config, generated from adaptv.config.ts. It is NEVER written to disk:
//adaptv's patched `@capacitor/cli` reads it in-memory from the `ADAPTV_CAPACITOR_CONFIG`
//env var (the CLI sets it before every `cap` call), so the consumer's project carries no
//`capacitor.config.json` at all — the only copy that exists is the one `cap` bakes into the
//native project. `appId` in adaptv.config is all it takes.

/** The subset of `capacitor.config.json` adaptv owns. */
export type CapacitorConfigJson = {
  appId: string
  appName: string
  webDir: string
  //Native projects live under `.adaptv/`; paths are app-root-relative (cap's CWD).
  android: { path: string; minWebViewVersion: number }
  ios: { path: string }
  //Open-ended on purpose: adaptv's own blocks are spelled out in `buildCapacitorConfig`
  //(SplashScreen / StatusBar / SystemBars), but a consumer can add settings for any plugin
  //they registered via `adaptv.config.ts` `pluginConfig`, which no fixed shape can enumerate.
  plugins: Record<string, unknown>
  //The generator sets `errorPath` (it is a static fact of every native build — see
  //ERROR_PAGE). The rest is the CLI's, at run time via the env config: `dev`'s live-reload
  //replaces this whole block to point the native WebView at the Vite server.
  server?: {
    url?: string
    cleartext?: boolean
    errorPath?: string
    androidScheme?: string
  }
}

/**
 * The SPA build output (see the `capacitor` vite target) that the WebView loads.
 *
 * Inside `.adaptv/`, NOT `dist/`, and that is the fix for a measured bug. Both
 * lineages used to write `dist/client`, and they were kept apart in TIME only —
 * the CLI runs a fresh `ADAPTV_TARGET=capacitor` build before every `cap sync`.
 * That holds for `render: "ssr"` by luck, because the server build relocates the
 * web output to `.output/`. Under `render: "spa"` the two collided: `vite build`
 * wrote `dist/client` with a service worker, the capacitor build emptied the same
 * directory and wrote its own without one, and `adaptv preview all` then served
 * the WebView bundle on the web surface — silently, because the two `index.html`
 * files are byte-identical and only the hashed chunks differ.
 *
 * Separate in SPACE now. `dist/` means what a host deploys; `.adaptv/web` is an
 * intermediate the native project consumes, which is what it always was — and it
 * inherits `.adaptv/`'s automatic gitignore entry rather than needing its own.
 *
 * cap runs with its CWD at the app root (config comes from env, not a file), so
 * paths here are app-root-relative, as upstream expects.
 */
export const CAPACITOR_WEB_DIR = ".adaptv/web"

/**
 * The Android WebView adaptv refuses to run below.
 *
 * **This is a floor, not a fix.** The bug that prompted it — Chromium 113–118 silently
 * dropping every Tailwind v4 `ring-*` utility — is *patched*, unconditionally, by
 * `vite/ring-shadow-fallback.ts`. Gating those devices out would now mean refusing to boot
 * on hardware adaptv renders correctly, so the floor sits below them.
 *
 * 111 is **Tailwind v4's own stated minimum** (Chrome 111 / Safari 16.4 / Firefox 128).
 * Below it the app's stylesheet is outside what its CSS toolchain claims to compile for, so
 * adaptv cannot honestly promise anything — which is exactly what a floor is for. It costs
 * nothing real: every device Capacitor 8 supports (`minSdk` 24 = Android 7) reaches at least
 * Chromium 119 (docs/decisions/register.md B21), well above it.
 *
 * What it replaces is Capacitor's default of **60** — Chromium 60 shipped in 2017, so the
 * built-in gate can never fire on any device that runs Capacitor 8 (B21). The alternative to
 * a floor is not "more devices work", it is a white screen with no explanation.
 *
 * Mirrored as `MIN_ANDROID_WEBVIEW` in `bin/lib/offline-page.mjs`, which renders the screen
 * this gate shows. `offline-page.test.mjs` fails if the two drift.
 */
export const MIN_ANDROID_WEBVIEW = 111

/**
 * `server.errorPath` — the page Capacitor loads when the main frame can't load, AND
 * (Android) when {@link MIN_ANDROID_WEBVIEW} is not met: `Bridge.loadWebView()` routes
 * both through this one path. Set on EVERY native build, not just `dev`.
 *
 * Without it the version gate is a no-op — Capacitor's `else` branch only logs
 * `MINIMUM_ANDROID_WEBVIEW_ERROR` and falls through to load the app anyway. The page
 * itself tells the two causes apart from its own user-agent, so `dev`'s "couldn't reach
 * the dev server" screen keeps its meaning.
 *
 * Duplicated from `bin/lib/offline-page.mjs`'s `OFFLINE_PAGE` rather than imported: this
 * module is framework source and must not pull the CLI into the bundle. Same trade the
 * `CAPACITOR_WEB_DIR` / `CAP_WEB_DIR` pair already makes; both sides assert the literal
 * (`capacitor-config.test.ts` + `offline-page.test.mjs`), which IS the contract.
 */
const ERROR_PAGE = "adaptv-offline.html"

/**
 * How long the update watchdog waits for `markBundleReady()` before reverting.
 *
 * 🔴 **Derived, never a literal.** The plugin defaults `readyTimeout` to `0`, which
 * disables rollback outright — and `autoBlockRolledBackBundles` is documented as
 * having no effect at `0` either, so a zero silently removes two defences and a
 * single bad bundle is unrecoverable on every installed device. → `§5.5`
 *
 * The plugin README recommends `10000`. adaptv does not use it, because the two
 * clocks start at different moments (`§5.4`): the rollback timer starts in the
 * plugin's constructor, *before* the WebView has loaded a document at all, while
 * `BOOT_GRACE_MS` starts at `DOMContentLoaded`. The constraint is therefore
 *
 *     readyTimeout ≥ (native launch → DOMContentLoaded) + BOOT_GRACE_MS + margin
 *
 * and `10000` against a `BOOT_GRACE_MS` of `8000` can leave a *negative* margin.
 * Get it wrong in that direction and a merely **slow** bundle is rolled back
 * before the document has even given up on it — which `autoBlockRolledBackBundles`
 * then makes permanent. A false rollback is worse than no rollback.
 *
 * The allowance is the slow target, not the fast one: measured at ~0.4 s on an iOS
 * simulator (plugin init → `WebView loaded`), against the 1–3 s a cold Android
 * start costs. It is expressed against {@link BOOT_GRACE_MS} so the two cannot
 * drift apart silently — `capacitor-config.test.ts` fails if they do.
 */
const NATIVE_BOOT_ALLOWANCE_MS = 3000
const ROLLBACK_MARGIN_MS = 4000
export const OTA_READY_TIMEOUT_MS =
  BOOT_GRACE_MS + NATIVE_BOOT_ALLOWANCE_MS + ROLLBACK_MARGIN_MS

export function buildCapacitorConfig(
  config: AdaptvAppConfig,
): CapacitorConfigJson {
  if (!config.appId) {
    throw new Error(
      "adaptv.config.ts: `appId` is required to generate capacitor.config (native build)",
    )
  }
  return {
    appId: config.appId,
    appName: config.appName ?? config.name,
    webDir: CAPACITOR_WEB_DIR,
    android: {
      path: `${ADAPTV_DIR}/android`,
      minWebViewVersion: MIN_ANDROID_WEBVIEW,
    },
    ios: { path: `${ADAPTV_DIR}/ios` },
    //`dev` REPLACES this block wholesale (live-reload's url/cleartext/androidScheme, with
    //its own errorPath), so this is the production half — see ERROR_PAGE.
    server: { errorPath: ERROR_PAGE },
    plugins: {
      //consumer-registered per-plugin native settings (adaptv.config.ts `pluginConfig`),
      //overridable by the adaptv defaults below.
      ...config.pluginConfig,
      SplashScreen: {
        //Hold the OS launch splash until the app explicitly hands off: RoutingShell calls
        //hideNativeSplash() once the custom React splash has painted, so there's no gap
        //(auto-hide could clear the native splash before the JS shell is ready → a flash).
        launchAutoHide: false,
        //DELIBERATELY no backgroundColor: the plugin's held view uses a single fixed
        //colour that can't follow the theme, so on a dark launch it flashes the light
        //mask. Omitting it lets the theme-aware pre-paint critical CSS (the WebView's
        //own html background) show through instead — the real mask colour comes from
        //the launch theme (Android) / launch storyboard colour asset (iOS).
        showSpinner: false,
        androidScaleType: "CENTER_CROP",
      },
      StatusBar: {
        //edge-to-edge is always on (opinionated): content draws under the status bar,
        //the shell's safe-area utilities pad it back. NOTE: `@capacitor/status-bar`'s
        //overlaysWebView/backgroundColor are dead on Android API 35+/36 (per the plugin
        //README and docs/decisions/register.md §6.0). SystemBars below now owns edge-to-edge + insets;
        //this block survives only for iOS + older Android until @adaptv/shell (roadmap #4).
        overlaysWebView: true,
        style: "DEFAULT",
      },
      SystemBars: {
        //Capacitor 8 core (bundled in @capacitor/android, registered unconditionally).
        //`css` injects `--safe-area-inset-*` on `document.documentElement` on Android —
        //the values the locked safe-area contract consumes var-first, because
        //`env(safe-area-inset-*)` reads 0/wrong in WebView < 140 (crbug/40699457). This
        //is the native half that makes styles/safe-area.css real on Android.
        insetsHandling: "css",
        //`DEFAULT` derives light/dark bar icons from the device/content — the supported
        //2026 replacement for the dead StatusBar.setBackgroundColor. applyStatusBar()
        //(capabilities/status-bar.ts) refines it per resolved theme at runtime.
        style: "DEFAULT",
      },
      ...liveUpdatePlugin(config),
    },
  }
}

/**
 * The update plugin's block — emitted **only when OTA is configured**.
 *
 * Off means off: with no channel the app never downloads anything, nothing calls
 * `settleLaunch()`, and arming a watchdog that no code will ever answer would be
 * a timer waiting for a signal that structurally cannot arrive.
 *
 * Every value here is adaptv taking a position, which is the whole of `§5.5` —
 * own the policy, rent the swap. The plugin is rented for one thing: writing a
 * bundle directory and flipping `serverBasePath`. Every decision *about* that
 * swap stays in `src/ota/policy.ts`, where it is testable without a device.
 */
function liveUpdatePlugin(
  config: AdaptvAppConfig,
): Record<string, unknown> {
  if (!resolveOtaOrigin(config)) return {}
  const publicKey = resolveOtaPublicKey(config)
  return {
    LiveUpdate: {
      //adaptv decides WHEN to update — `background` would give the plugin its own
      //check-and-apply loop running beside `startOtaUpdates`, so two policies
      //would race over the same pointer and neither would own the outcome.
      autoUpdateStrategy: "none",
      readyTimeout: OTA_READY_TIMEOUT_MS,
      //The device's own memory of what already failed to start here. Without it a
      //rolled-back bundle is re-downloaded on the very next launch, forever: the
      //channel keeps advertising it, because a rollback is a local event no server
      //hears about. `decideUpdate` reads this back via `getBlockedBundles()`.
      autoBlockRolledBackBundles: true,
      //MUST stay false. "Unused" is the plugin's judgement, made right after
      //`ready()`, and the bundle it would consider unused is the last known-good
      //one — i.e. exactly the rollback target. Pruning is adaptv's
      //(`selectPrunableBundles`), precisely because it has to keep that.
      autoDeleteBundles: false,
      //🔴 The whole of the native defence. The plugin verifies a bundle's
      //signature ONLY when this is set — no key means no check, silently, and a
      //channel anyone who can write to the CDN owns. It is therefore emitted
      //whenever the app declares one, and `adaptv build web` refuses to publish
      //without it (the `ADAPTV_OTA_ALLOW_UNSIGNED` hatch is local-only).
      //
      //Through the shared resolver, so the key the native check uses is the same
      //one the JS check uses. → `resolveOtaPublicKey`
      ...(publicKey ? { publicKey } : {}),
    },
  }
}

/**
 * The generated config as the JSON string for `ADAPTV_CAPACITOR_CONFIG` (see the file
 * header), or `null` when there's no `appId` — web-only apps ship no Capacitor config.
 *
 * `overrides` carry the per-run tweaks the CLI applies without a file: the `.dev` install
 * identity (dev/preview) and the live-reload `server` block (dev).
 */
export function capacitorConfigJson(
  config: AdaptvAppConfig,
  overrides?: Partial<CapacitorConfigJson>,
): string | null {
  if (!config.appId) return null
  return JSON.stringify({ ...buildCapacitorConfig(config), ...overrides })
}
