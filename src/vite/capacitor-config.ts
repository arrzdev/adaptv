import { writeFileSync } from "node:fs"
import path from "node:path"
import type { AdaptvAppConfig } from "#adaptv/config/app-config.ts"
import { ADAPTV_DIR } from "#adaptv/vite/adaptv-dir.ts"

//The Capacitor config, generated from adaptv.config.ts. Consumers never hand-write
//this — `appId` in adaptv.config is all it takes (mirrors how the web manifest is
//generated).

/** The subset of `capacitor.config.json` adaptv owns. */
export type CapacitorConfigJson = {
  appId: string
  appName: string
  webDir: string
  //The native projects live inside the hidden `.adaptv/` dir (git-ignored, regenerated),
  //not at the app root — everything adaptv generates sits in one disposable place. These
  //paths are relative to this config file (the app root), which `cap` reads from CWD.
  android: { path: string }
  ios: { path: string }
  plugins: {
    SplashScreen: {
      launchAutoHide: boolean
      showSpinner: boolean
      androidScaleType: string
    }
    StatusBar: {
      overlaysWebView: boolean
      style: string
    }
    SystemBars: {
      insetsHandling: "css"
      style: string
    }
  }
}

//the SPA build output (see the `capacitor` vite target) that the WebView loads.
//Start controls the client environment's output dir and emits the SPA to
//`dist/client`; a plugin-level `build.outDir` is overridden. The lineages are
//kept separate in TIME — the CLI runs a fresh `ADAPTV_TARGET=capacitor` build
//before every `cap sync`, so a web build's server bundle is never synced.
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
 * Stamp `capacitor.config.json` at the app root from the config, when `appId` is set
 * (native build). No-op otherwise (web-only apps ship no Capacitor config). `cap`
 * reads this generated file — the consumer never hand-writes one.
 */
export function stampCapacitorConfig(
  config: AdaptvAppConfig,
  appRoot: string,
): void {
  if (!config.appId) return
  const json = JSON.stringify(buildCapacitorConfig(config), null, 2)
  writeFileSync(path.join(appRoot, "capacitor.config.json"), `${json}\n`)
}
