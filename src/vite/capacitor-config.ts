import { writeFileSync } from "node:fs"
import path from "node:path"
import type { NativAppConfig } from "#nativ/config/app-config.ts"

//The Capacitor config, generated from nativ.config.ts. Consumers never hand-write
//this — `appId` in nativ.config is all it takes (mirrors how the web manifest is
//generated).

/** The subset of `capacitor.config.json` nativ owns. */
export type CapacitorConfigJson = {
  appId: string
  appName: string
  webDir: string
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
  }
}

//the SPA build output (see the `capacitor` vite target) that the WebView loads.
const CAPACITOR_WEB_DIR = "dist-capacitor/client"

export function buildCapacitorConfig(
  config: NativAppConfig,
): CapacitorConfigJson {
  if (!config.appId) {
    throw new Error(
      "nativ.config.ts: `appId` is required to generate capacitor.config (native build)",
    )
  }
  return {
    appId: config.appId,
    appName: config.appName ?? config.name,
    webDir: CAPACITOR_WEB_DIR,
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
        //the shell's safe-area utilities pad it back.
        overlaysWebView: true,
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
  config: NativAppConfig,
  appRoot: string,
): void {
  if (!config.appId) return
  const json = JSON.stringify(buildCapacitorConfig(config), null, 2)
  writeFileSync(path.join(appRoot, "capacitor.config.json"), `${json}\n`)
}
