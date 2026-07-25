import type { AdaptvAppConfig } from "#adaptv/config/app-config.ts"
import { ADAPTV_DIR } from "#adaptv/vite/adaptv-dir.ts"

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
  android: { path: string }
  ios: { path: string }
  //Open-ended on purpose: adaptv's own blocks are spelled out in `buildCapacitorConfig`
  //(SplashScreen / StatusBar / SystemBars), but a consumer can add settings for any plugin
  //they registered via `adaptv.config.ts` `pluginConfig`, which no fixed shape can enumerate.
  plugins: Record<string, unknown>
  //Set only by the CLI at run time (via the env config), never by the generator: the
  //live-reload dev server (`dev`) points the native WebView at the Vite server.
  server?: {
    url?: string
    cleartext?: boolean
    errorPath?: string
    androidScheme?: string
  }
}

//the SPA build output (see the `capacitor` vite target) that the WebView loads.
//Start controls the client environment's output dir and emits the SPA to
//`dist/client`; a plugin-level `build.outDir` is overridden. The lineages are
//kept separate in TIME — the CLI runs a fresh `ADAPTV_TARGET=capacitor` build
//before every `cap sync`, so a web build's server bundle is never synced.
//cap runs with its CWD at the app root (config comes from env, not a file), so paths are
//app-root-relative, as upstream expects. The native projects live under `.adaptv/`.
const CAPACITOR_WEB_DIR = "dist/client"

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
    android: { path: `${ADAPTV_DIR}/android` },
    ios: { path: `${ADAPTV_DIR}/ios` },
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
        //README and DECISIONS.md §6.0). SystemBars below now owns edge-to-edge + insets;
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
    },
  }
}

/**
 * The generated Capacitor config as a JSON string for the `ADAPTV_CAPACITOR_CONFIG` env var
 * (native build), or `null` when there's no `appId` (web-only apps ship no Capacitor config).
 * Never written to disk — adaptv's patched `@capacitor/cli` reads it from the env, so no
 * `capacitor.config.json` exists in the consumer's project.
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
