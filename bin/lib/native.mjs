// Native-project mechanics for the adaptv CLI: where the Capacitor projects live,
// the colour-driven splash/icon patchers, the SPA build, and the `cap` wrappers.
// Extracted from bin/adaptv.mjs so the entry file stays a thin dispatcher. Every
// long-running command streams through the captured `exec` (see exec.mjs) so its
// output can be rendered as calm steps instead of a raw log dump.
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { homedir, networkInterfaces, tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ADAPTV_DIR } from "./adaptv-dir.mjs"
import { buildIdEnv } from "./build-stamp.mjs"
import { exec } from "./exec.mjs"
import { appConfigFingerprint } from "./fingerprint.mjs"
import { brandLauncherIcon, loadIconSet } from "./icons.mjs"
import { loadAdaptvModule } from "./load-ts.mjs"
import {
  classListChanged,
  gradleProjectName,
  mergeCapacitorBuildGradle,
  mergeClassList,
  mergePbxprojResource,
  mergePluginsJson,
  mergeSettingsGradle,
  podsNeedInstall,
  resolvePluginPackages,
} from "./native-state.mjs"
import { readSection, writeSection } from "./state.mjs"

// The framework package root (bin/lib/native.mjs → up two). adaptv OWNS Capacitor:
// the `cap` CLI, both native platforms, and every plugin are adaptv's OWN deps, so
// the toolchain resolves from HERE, never from the consumer's app (which declares no
// @capacitor/* at all). → the whole point: a consumer never touches Capacitor.
export const ADAPTV_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
)

//Re-exported so every existing importer keeps working; the constant itself lives in its own
//module to break the native ↔ fingerprint cycle.
export { ADAPTV_DIR } from "./adaptv-dir.mjs"
/** Where `adaptv build` puts its artifacts: `.adaptv/builds/<app>.ipa|.apk`. */
export const BUILDS_DIR = "builds"
/** Absolute path to a platform's native project, now under `.adaptv/`. */
export const nativeDir = (appRoot, platform) =>
  path.join(appRoot, ADAPTV_DIR, platform)
/** The generated Capacitor config, carried in the `ADAPTV_CAPACITOR_CONFIG` env var —
 * adaptv's patched `@capacitor/cli` reads it in-memory, so NO `capacitor.config.json` exists
 * in the consumer's project (cap runs at the app root and inherits this env via platformEnv,
 * which spreads `process.env`). Returns null when unset (web-only, or config not yet built). */
export function capConfigFromEnv() {
  try {
    return JSON.parse(process.env.ADAPTV_CAPACITOR_CONFIG ?? "")
  } catch {
    return null
  }
}
/** Merge run-time overrides into the env-carried config — the `.dev` install identity
 * (dev/preview) and the live-reload `server` block (dev) — replacing the old in-place file
 * mutation. Ephemeral: it dies with the process, so a killed run leaves no stale state. */
export function updateCapacitorEnv(overrides) {
  process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify({
    ...(capConfigFromEnv() ?? {}),
    ...overrides,
  })
}

/** Overlay the LIVE env-carried config onto a spawn env. The per-platform env is MEMOIZED
 * (built once, before the config is finalized — the dev server `url` and the `.dev` identity
 * are layered on later), and the config now travels IN that env, so cap must always receive
 * the CURRENT `ADAPTV_CAPACITOR_CONFIG`, never the stale snapshot. */
function withLiveCapConfig(env) {
  return process.env.ADAPTV_CAPACITOR_CONFIG
    ? {
        ...env,
        ADAPTV_CAPACITOR_CONFIG: process.env.ADAPTV_CAPACITOR_CONFIG,
      }
    : env
}

/**
 * The SPA build output the WebView loads. Mirrors `CAPACITOR_WEB_DIR` in
 * `src/vite/capacitor-config.ts` — duplicated rather than imported so the CLI
 * never pulls framework source in, and pinned to it by `capacitor-config.test.ts`.
 *
 * Under `.adaptv/`, never `dist/`: this is an intermediate the native project
 * consumes, and it used to share `dist/client` with the web build. See that
 * constant for what the shared directory silently did to a `render: "spa"` app.
 */
export const CAP_WEB_DIR = ".adaptv/web"

/** Path to a local `node_modules/.bin/<name>`, or null. */
export function localBin(appRoot, name) {
  const p = path.join(appRoot, "node_modules", ".bin", name)
  return existsSync(p) ? p : null
}

/** Invoke `cap` through adaptv's shim (bin/lib/cap.mjs) — it guarantees the in-memory
 * `ADAPTV_CAPACITOR_CONFIG` behaviour on BOTH a patched install (dev/link) and an unpatched
 * one (published, where pnpm won't carry adaptv's patch). adaptv owns `@capacitor/cli`, so
 * the shim can always resolve it. → bin/lib/cap.mjs, docs/decisions/register.md L20. */
export function capCmd(_appRoot) {
  return {
    cmd: process.execPath,
    pre: [path.join(ADAPTV_ROOT, "bin", "lib", "cap.mjs")],
  }
}

/**
 * Run a captured command; each raw line goes to `report`. Throws on failure.
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, report?: (line: string) => void }} [opts]
 */
function run(cmd, args, { cwd, env, report } = {}) {
  return exec(cmd, args, { cwd, env, onLine: (l) => report?.(l) })
}

/** Write only when the content actually differs — these files feed the native build's own
 * up-to-date checks, and rewriting an identical Gradle file invalidates it for nothing. */
function writeIfChanged(file, next) {
  if (existsSync(file) && readFileSync(file, "utf8") === next) return
  writeFileSync(file, next)
}

/**
 * The one answer to "what colour is this app, per appearance".
 *
 * `resolveThemeColors` lives in `src/config/app-config.ts` because the vite side needs it too
 * — the manifest, the shell and the root route all resolve `themeColor` through it, and the
 * config is the single build-time source of truth for that value. Both functions below used
 * to spell `theme.dark ?? theme.light` out by hand instead, which is the same rule written
 * three times and answerable to nobody: a new fallback, a normalisation or a validation added
 * to the resolver would have left the native launcher and splash on the old one, silently,
 * with the two halves of the app painting different colours.
 *
 * Reached the way `bin/` reaches every other idea that belongs to `src/` (`load-ts.mjs`):
 * bundled once per process, so this costs nothing after the first call.
 *
 * A missing `themeColor` reaches the resolver and is refused there. It used to become black
 * and white here, which is the guess `preflight` exists to stop — and `preflight` refuses it
 * under the banner before any of this runs, so the resolver's throw is the backstop and not
 * the message anyone sees.
 */
const themeColors = async (config) => {
  const { resolveThemeColors } = await loadAdaptvModule(
    "config/app-config.ts",
  )
  return resolveThemeColors(config.themeColor ?? {})
}

/**
 * What the launcher icon SITS ON (icon only; the splash is colour-driven).
 *
 * WHERE it comes from is not here and must not be: `resolveIconSet` in
 * `src/vite/icon-set.ts` is the one place that answers that, for the manifest, the head and
 * the launcher alike. This used to also return `dir: config.icons ?? "./public/favicons"`,
 * a second copy of a fallback rule that nothing read — dead code, and the kind that only
 * looks harmless until someone changes one copy.
 */
export async function resolveIconPlan() {
  return {
    //White, NOT the light theme colour: these icons sit on someone else's home screen, not
    //inside the app, and the PWA set the source comes from is drawn against white too.
    //One colour for both appearances, too — `writeAndroidIcons` says why the launcher tile
    //never follows the dark theme.
    iconBackground: "#ffffff",
  }
}

/**
 * The launch-splash MASK — the flat colour the OS splash paints before the React
 * splash. Returns light + dark colours and a `follow`:
 *   - "preferences" → native override makes it follow the app theme (default)
 *   - "system"      → adaptive colours, no override (follows the device)
 *   - "none"        → fixed (both colours identical; theme-independent)
 */
export async function resolveSplashMask(config) {
  const theme = await themeColors(config)
  const light =
    config.splashMaskLightColor ?? config.backgroundColor ?? theme.light
  const dark = config.splashMaskDarkColor ?? theme.dark
  const mode = config.splashMaskMode ?? "preferences"
  if (mode === "light") return { light, dark: light, follow: "none" }
  if (mode === "dark") return { light: dark, dark, follow: "none" }
  if (mode === "system") return { light, dark, follow: "system" }
  return { light, dark, follow: "preferences" }
}

/* =============================================================================
 * Android splash (colour-driven, no logo) — see the long note in the original CLI.
 * ============================================================================= */

const ANDROID_TRANSPARENT_ICON = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@android:color/transparent" />
</shape>
`
function androidColorsXml(hex) {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="adaptvSplashBackground">${hex}</color>
</resources>
`
}
function androidLaunchStyles(platform) {
  const p = platform ? "android:" : ""
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:windowBackground">@color/adaptvSplashBackground</item>
        <item name="${p}windowSplashScreenBackground">@color/adaptvSplashBackground</item>
        <item name="${p}windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>
</resources>
`
}

/*
 * The theme the activity runs on AFTER the launch splash hands off
 * (`postSplashScreenTheme`). Capacitor's stock version inherits AppCompat's grey
 * `windowBackground` — `#fafafa` light, `#303030` dark — and that colour is what shows
 * through wherever the WebView is not covering the screen. It is also literally what
 * `SystemBars.setStyle()` paints the decor view with (`getThemeColor(windowBackground)`).
 *
 * So the grey is not one bug, it is the *background* of every edge-to-edge failure: the
 * split second before first paint, an old WebView on Capacitor's inset-PADDING fallback
 * (< WebView 140, where drawing under the bars is not attempted at all), a device the
 * probe never fired on. Pointing it at the same theme-aware colour as the splash mask
 * means the worst case is a band that MATCHES the app instead of a grey one — on every
 * Android version, without depending on anything the JS layer did or didn't manage to do.
 *
 * The bar colours only do work below API 35 (from 35 the system owns the bars and ignores
 * them, `docs/roadmap/native-shell-plugin.md` §0.0), and that is exactly where they are needed: pre-15 Android
 * paints `colorPrimaryDark` behind the status bar otherwise. The contrast opt-outs are
 * API 29+, so they live in `values-v29` rather than making the base theme reference an
 * attribute half the minSdk range has never heard of.
 */
const ANDROID_APP_THEME_ITEMS = `        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:windowBackground">@color/adaptvSplashBackground</item>
        <item name="android:windowDrawsSystemBarBackgrounds">true</item>
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:navigationBarColor">@android:color/transparent</item>`

//API 29+ only: without these Android paints its own translucent scrim over a transparent
//bar, which is the same grey band by another route.
const ANDROID_APP_THEME_ITEMS_V29 = `${ANDROID_APP_THEME_ITEMS}
        <item name="android:enforceStatusBarContrast">false</item>
        <item name="android:enforceNavigationBarContrast">false</item>`

function androidAppTheme(items) {
  return `    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
${items}
    </style>`
}

function androidAppThemeStyles(items) {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
${androidAppTheme(items)}
</resources>
`
}

/*
 * The edge-to-edge half of the generated activity — the ONLY thing that ever puts an
 * Android app under the system bars, and the only thing that reports the insets back
 * when Capacitor won't.
 *
 * Android 15 (API 35) enforces edge-to-edge. Below that NOTHING in the stack asks for it:
 * Capacitor 8's `SystemBars` only *reports* insets (it never touches the window), and
 * `@capacitor/status-bar`'s `setOverlaysWebView` is the deprecated `setSystemUiVisibility`
 * path Play Console now warns about — which covered the status bar and never the gesture
 * bar, so it produced a half-overlay even when it worked. Measured on a Pixel 7 emulator
 * (API 34): `innerHeight` 891 of 915 — under the status bar, above the nav bar.
 *
 * One AndroidX call replaces it, on API 21+, for both bars, from `onCreate` — so there is
 * no plugin to be registered and no JS round-trip to lose a race to.
 */
const ANDROID_EDGE_TO_EDGE_JAVA = `
    // The WebView major version Capacitor's SystemBars requires before it will pass real
    // insets through to CSS (crbug/40699457). Below it the plugin injects zeros — see
    // adaptvOwnInsetsOnOldWebView().
    private static final int ADAPTV_WEBVIEW_WITH_SAFE_AREA_FIX = 140;

    private void adaptvEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        adaptvOwnInsetsOnOldWebView();
    }

    /**
     * Report the real insets to the page on the WebViews where SystemBars refuses to.
     *
     * SystemBars passes insets through to \`--safe-area-inset-*\` only when the WebView is
     * >= 140; below that it injects \`0px\` for all four ON PURPOSE, because it assumes the
     * page is NOT drawing under the bars. Now that it is, those zeros are the bug: content
     * sits under the status bar with nothing to pad it (the app header on top of the clock).
     *
     * So on an old WebView adaptv takes the listener over. This REPLACES SystemBars' rather
     * than joining it — a View holds exactly one \`OnApplyWindowInsetsListener\`, and ours is
     * installed after the bridge loaded the plugin, so exactly one remains in the hierarchy.
     * The two-listeners-on-one-hierarchy collision behind capacitor-keyboard#61/#68 cannot
     * happen. On WebView >= 140 this does nothing and SystemBars keeps its whole pipeline,
     * Chromium workarounds and all — adaptv rents it, per docs/roadmap/native-shell-plugin.md §0.0.
     */
    private void adaptvOwnInsetsOnOldWebView() {
        if (adaptvWebViewMajorVersion() >= ADAPTV_WEBVIEW_WITH_SAFE_AREA_FIX) return;
        if (getBridge() == null || getBridge().getWebView() == null) return;
        View parent = (View) getBridge().getWebView().getParent();
        if (parent == null) return;
        final int barTypes = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();
        ViewCompat.setOnApplyWindowInsetsListener(parent, (v, insets) -> {
            Insets bars = insets.getInsets(barTypes);
            boolean keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            // The view is deliberately NOT resized for the keyboard. adaptv runs Capacitor
            // Keyboard in resize=None and lifts content itself from the reported height
            // (capabilities/keyboard.ts, the suppress-native-then-reimplement rule); padding the
            // view for the IME here too would double that lift — the sheet grows by the keyboard
            // height inside a viewport already shrunk by it, which is the full-height drawer with
            // a keyboard-sized gap under it. On WebView >= 140 this listener isn't installed at
            // all and SystemBars never resizes either, so leaving the view alone is also what
            // keeps the two WebView eras identical. While the IME is up the gesture bar sits
            // behind it, so the bottom inset drops to 0 — the same value env() reports on >= 140.
            int bottom = keyboardVisible ? 0 : bars.bottom;
            adaptvInjectInsets(bars.left, bars.top, bars.right, bottom);
            // Deliberately NOT WindowInsetsCompat.CONSUMED — returning that breaks the
            // WebView's own safe-area recalculation (crbug/461332423).
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(barTypes, Insets.of(bars.left, bars.top, bars.right, bottom))
                .build();
        });
        getBridge().getWebView().requestApplyInsets();
    }

    // Same four properties, same integer-truncated dp, same element as SystemBars writes
    // (styles/safe-area.css consumes them var-first) — so nothing downstream can tell which
    // of the two produced a given pass.
    private void adaptvInjectInsets(int left, int top, int right, int bottom) {
        float density = getResources().getDisplayMetrics().density;
        String script = String.format(
            Locale.US,
            "try{var s=document.documentElement.style;" +
                "s.setProperty('--safe-area-inset-top','%dpx');" +
                "s.setProperty('--safe-area-inset-right','%dpx');" +
                "s.setProperty('--safe-area-inset-bottom','%dpx');" +
                "s.setProperty('--safe-area-inset-left','%dpx');}catch(e){}",
            (int) (top / density),
            (int) (right / density),
            (int) (bottom / density),
            (int) (left / density)
        );
        getBridge().getWebView().evaluateJavascript(script, null);
    }

    // 0 when the version can't be read (API < 26, or no WebView package) — which routes to
    // adaptv owning the insets. That is the safe default: a wrong "modern" answer means the
    // page gets zeros and no padding, a wrong "old" answer just means adaptv reports them.
    private int adaptvWebViewMajorVersion() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return 0;
        PackageInfo info = WebView.getCurrentWebViewPackage();
        if (info == null || info.versionName == null) return 0;
        try {
            return Integer.parseInt(info.versionName.split("\\\\.")[0]);
        } catch (NumberFormatException e) {
            return 0;
        }
    }
`

//Imports the edge-to-edge block needs, in two groups so each variant can interleave its
//own and still come out in the order a human would have written them (android, androidx,
//com, java). `java.util.Locale` sorts last in both, so it's written inline there.
const ANDROID_SHELL_IMPORTS_PLATFORM = `import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebView;`
const ANDROID_SHELL_IMPORTS_ANDROIDX = `import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;`

function androidMainActivityPlain(appId) {
  return `package ${appId};

${ANDROID_SHELL_IMPORTS_PLATFORM}
${ANDROID_SHELL_IMPORTS_ANDROIDX}
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // after super: the bridge (and its WebView) is created in BridgeActivity.onCreate,
        // and installing the inset listener after the plugin loaded is what makes ours win.
        adaptvEdgeToEdge();
    }
${ANDROID_EDGE_TO_EDGE_JAVA}}
`
}

function androidMainActivityThemed(appId) {
  return `package ${appId};

import android.app.UiModeManager;
import android.content.Context;
import android.content.SharedPreferences;
${ANDROID_SHELL_IMPORTS_PLATFORM}
import androidx.appcompat.app.AppCompatDelegate;
${ANDROID_SHELL_IMPORTS_ANDROIDX}
import com.getcapacitor.BridgeActivity;
import java.util.Locale;

public class MainActivity extends BridgeActivity {

    private SharedPreferences.OnSharedPreferenceChangeListener adaptvThemeListener;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        applyAdaptvTheme(true);
        super.onCreate(savedInstanceState);
        // after super: the bridge (and its WebView) is created in BridgeActivity.onCreate,
        // and installing the inset listener after the plugin loaded is what makes ours win.
        adaptvEdgeToEdge();
        // uiMode is in the activity's configChanges, so applying live does NOT reload
        // the WebView; kept as a field so the listener isn't garbage-collected.
        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        adaptvThemeListener = (sp, key) -> {
            if ("adaptv-theme".equals(key)) {
                applyAdaptvTheme(false);
            }
        };
        prefs.registerOnSharedPreferenceChangeListener(adaptvThemeListener);
    }

    // AppCompatDelegate only at startup (before super.onCreate) — calling it live
    // recreates the activity; the live path only touches UiModeManager.
    private void applyAdaptvTheme(boolean atStartup) {
        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String pref = prefs.getString("adaptv-theme", "system");
        int appCompatMode = AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM;
        int uiMode = UiModeManager.MODE_NIGHT_AUTO;
        if ("dark".equals(pref)) {
            appCompatMode = AppCompatDelegate.MODE_NIGHT_YES;
            uiMode = UiModeManager.MODE_NIGHT_YES;
        } else if ("light".equals(pref)) {
            appCompatMode = AppCompatDelegate.MODE_NIGHT_NO;
            uiMode = UiModeManager.MODE_NIGHT_NO;
        }
        if (atStartup) {
            AppCompatDelegate.setDefaultNightMode(appCompatMode);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            UiModeManager manager = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
            if (manager != null) {
                manager.setApplicationNightMode(uiMode);
            }
        }
    }
${ANDROID_EDGE_TO_EDGE_JAVA}}
`
}

/**
 * Patch the Android themes: the launch theme (flat mask colour + transparent icon) and
 * the post-splash app theme (app-coloured window, transparent system bars).
 */
export function patchAndroidSplash(appRoot, mask, appId) {
  const res = path.join(nativeDir(appRoot, "android"), "app/src/main/res")
  if (!existsSync(res)) return
  const put = (rel, content) => {
    const p = path.join(res, rel)
    mkdirSync(path.dirname(p), { recursive: true })
    writeFileSync(p, content)
  }
  put("drawable/splash_icon.xml", ANDROID_TRANSPARENT_ICON)
  put("values/colors.xml", androidColorsXml(mask.light))
  put("values-night/colors.xml", androidColorsXml(mask.dark))
  put("values-v31/styles.xml", androidLaunchStyles(true))
  put(
    "values-v29/styles.xml",
    androidAppThemeStyles(ANDROID_APP_THEME_ITEMS_V29),
  )
  const stylesPath = path.join(res, "values/styles.xml")
  if (existsSync(stylesPath)) {
    const base = `    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:windowBackground">@color/adaptvSplashBackground</item>
        <item name="windowSplashScreenBackground">@color/adaptvSplashBackground</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`
    //`AppTheme.NoActionBar"` (with the closing quote) can't match `…NoActionBarLaunch`,
    //so the two rewrites are independent whichever order they run in.
    const styles = readFileSync(stylesPath, "utf8")
      .replace(
        /[ \t]*<style name="AppTheme\.NoActionBarLaunch"[\s\S]*?<\/style>/,
        base,
      )
      .replace(
        /[ \t]*<style name="AppTheme\.NoActionBar"[\s\S]*?<\/style>/,
        androidAppTheme(ANDROID_APP_THEME_ITEMS),
      )
    writeFileSync(stylesPath, styles)
  }
  const javaDir = path.join(
    nativeDir(appRoot, "android"),
    "app/src/main/java",
    appId.replace(/\./g, "/"),
  )
  mkdirSync(javaDir, { recursive: true })
  writeFileSync(
    path.join(javaDir, "MainActivity.java"),
    mask.follow === "preferences"
      ? androidMainActivityThemed(appId)
      : androidMainActivityPlain(appId),
  )
}

function hexToRgb(hex) {
  const h = hex.replace("#", "")
  const n =
    h.length === 3
      ? h
          .split("")
          .map((ch) => ch + ch)
          .join("")
      : h
  return {
    r: (Number.parseInt(n.slice(0, 2), 16) / 255).toFixed(3),
    g: (Number.parseInt(n.slice(2, 4), 16) / 255).toFixed(3),
    b: (Number.parseInt(n.slice(4, 6), 16) / 255).toFixed(3),
  }
}

function iosColorsetJson(mask) {
  const color = (hex) => {
    const { r, g, b } = hexToRgb(hex)
    return {
      "color-space": "srgb",
      components: { red: r, green: g, blue: b, alpha: "1.000" },
    }
  }
  const colors = [{ color: color(mask.light), idiom: "universal" }]
  if (mask.follow !== "none") {
    colors.push({
      appearances: [{ appearance: "luminosity", value: "dark" }],
      color: color(mask.dark),
      idiom: "universal",
    })
  }
  return `${JSON.stringify({ colors, info: { author: "adaptv", version: 1 } }, null, 2)}\n`
}

function iosLaunchStoryboard(lightHex) {
  const { r, g, b } = hexToRgb(lightHex)
  return `<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="21507" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="22685"/>
        <capability name="Named colors" minToolsVersion="9.0"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
    </dependencies>
    <scenes>
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController id="01J-lp-oVM" sceneMemberID="viewController">
                    <view key="view" contentMode="scaleToFill" id="Ze5-6b-2t3">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <viewLayoutGuide key="safeArea" id="Bcu-3y-fUX"/>
                        <color key="backgroundColor" name="AdaptvSplash"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
        </scene>
    </scenes>
    <resources>
        <namedColor name="AdaptvSplash">
            <color red="${r}" green="${g}" blue="${b}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
        </namedColor>
    </resources>
</document>
`
}

/** Patch the iOS colour asset + launch storyboard (+ AppDelegate for preference mode). */
export function patchIosTheme(appRoot, mask) {
  const iosApp = path.join(nativeDir(appRoot, "ios"), "App/App")
  if (!existsSync(iosApp)) return
  const colorsetDir = path.join(
    iosApp,
    "Assets.xcassets/AdaptvSplash.colorset",
  )
  mkdirSync(colorsetDir, { recursive: true })
  writeFileSync(
    path.join(colorsetDir, "Contents.json"),
    iosColorsetJson(mask),
  )
  const storyboard = path.join(
    iosApp,
    "Base.lproj/LaunchScreen.storyboard",
  )
  if (existsSync(path.dirname(storyboard))) {
    writeFileSync(storyboard, iosLaunchStoryboard(mask.light))
  }
  const appDelegate = path.join(iosApp, "AppDelegate.swift")
  if (existsSync(appDelegate)) {
    let src = readFileSync(appDelegate, "utf8")
    src = src.replace(
      /\n +\/\/ adaptv: follow the persisted[\s\S]*?\.unspecified\)/,
      "",
    )
    const marker =
      "// Override point for customization after application launch."
    if (mask.follow === "preferences" && src.includes(marker)) {
      src = src.replace(
        marker,
        `${marker}
        // adaptv: follow the persisted app theme (not system) for the splash + app.
        let adaptvThemePref = UserDefaults.standard.string(forKey: "CapacitorStorage.adaptv-theme") ?? "system"
        window?.overrideUserInterfaceStyle = adaptvThemePref == "dark" ? .dark : (adaptvThemePref == "light" ? .light : .unspecified)`,
      )
    }
    writeFileSync(appDelegate, src)
  }
}

/**
 * A content hash of THIS module — the single file that generates every native shell artifact:
 * the launcher icons/splash (`writeAndroidIcons`, `patchAndroidSplash`), the edge-to-edge
 * `MainActivity` (`androidMainActivity*`), and the namespace/identity (`patchNativeIdentity`).
 * Folded into the asset cache key below so ANY edit to a generator here invalidates an already-
 * scaffolded project and re-derives it — the "did the writer change?" half of the guard, now
 * computed instead of remembered.
 *
 * It REPLACES a hand-bumped `ASSETS_GEN_VERSION`, whose failure mode this is: PR #35 rewrote the
 * generated `MainActivity`/namespace but nothing bumped the constant, so every project scaffolded
 * before it kept the stale bare-stub `MainActivity` and edge-to-edge silently broke on old
 * WebViews (content sat under the status bar) until a clean rebuild. A content hash can't be
 * forgotten. Over-inclusive by the same rule as every fingerprint here — an unrelated edit to this
 * file just re-derives byte-identical assets, which is free; a missed generator change shipping
 * stale native code is not.
 */
export const GENERATOR_FINGERPRINT = createHash("sha1")
  .update(readFileSync(fileURLToPath(import.meta.url)))
  .digest("hex")

/** Everything `generateAssets` writes into, per platform. Hashed to answer "is it already there?" */
const ASSET_OUTPUTS = {
  ios: [
    "App/App/Assets.xcassets/AppIcon.appiconset",
    "App/App/Assets.xcassets/AdaptvSplash.colorset",
    "App/App/Base.lproj/LaunchScreen.storyboard",
    "App/App/AppDelegate.swift",
  ],
  android: [
    "app/src/main/res/mipmap-mdpi",
    "app/src/main/res/mipmap-hdpi",
    "app/src/main/res/mipmap-xhdpi",
    "app/src/main/res/mipmap-xxhdpi",
    "app/src/main/res/mipmap-xxxhdpi",
    "app/src/main/res/mipmap-anydpi-v26",
    "app/src/main/res/values/ic_launcher_background.xml",
    "app/src/main/res/values-night/ic_launcher_background.xml",
    //The SPLASH half, which this list is missing on the iOS side's own reasoning: iOS
    //named every file `patchIosTheme` writes (colourset, storyboard, AppDelegate) while
    //Android named only the launcher art, so `colors.xml` — the one file carrying the
    //theme colour into the Android shell — was invisible to the outputs guard. The
    //inputs half still caught a config edit, but a deleted, hand-edited or rescaffolded
    //colour resource was never repaired, which is exactly what the outputs half exists
    //for. Everything `patchAndroidSplash` writes now belongs here.
    "app/src/main/res/values/colors.xml",
    "app/src/main/res/values-night/colors.xml",
    "app/src/main/res/values/styles.xml",
    "app/src/main/res/values-v29/styles.xml",
    "app/src/main/res/values-v31/styles.xml",
    "app/src/main/res/drawable/splash_icon.xml",
    //The generated `MainActivity` lives at a path derived from `appId`, so the whole
    //source root is walked rather than one computed file. Over-inclusive by the rule
    //every hash here follows: an app's own hand-written Java re-derives byte-identical
    //assets ONCE and then hashes stable, while a missing MainActivity is repaired.
    "app/src/main/java",
  ],
}

/** A content hash of those paths as they are ON DISK right now. Missing hashes as absent. */
function assetOutputsHash(appRoot, platform) {
  const h = createHash("sha1")
  const root = nativeDir(appRoot, platform)
  const walk = (rel) => {
    const abs = path.join(root, rel)
    let st
    try {
      st = statSync(abs)
    } catch {
      h.update(`${rel}:absent\n`)
      return
    }
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort())
        walk(path.join(rel, name))
      return
    }
    h.update(`${rel}:`)
    try {
      h.update(readFileSync(abs))
    } catch {
      h.update("unreadable")
    }
    h.update("\n")
  }
  for (const rel of ASSET_OUTPUTS[platform] ?? []) walk(rel)
  return h.digest("hex")
}

/**
 * Write the launcher icons, the splash colours and the launch storyboard into the native
 * projects — unless they are already exactly the files that would be written. The splash
 * patches are synchronous file writes (it's a flat colour, not art); the launcher icon is
 * rendered from the app's icon set by `brandLauncherIcon`, which picks the member of that set
 * drawn for the platform being built.
 *
 * Says nothing. What is wrong with the source art is known from the icon directory alone, so
 * the CLI reads it at preflight and prints it above the run (`bin/lib/preflight.mjs`, R33);
 * returning the same sentences from here as well only gave a caller the chance to print them
 * a second time, halfway through work that had already used them.
 *
 * This runs on EVERY command, and it is ~18-23 sharp encodes (measured ~240ms for both
 * platforms) re-deriving byte-identical files from art that has not changed. The guard has two
 * halves and needs BOTH to skip:
 *
 *   inputs   `appConfigFingerprint` — the config file plus the icon directory it points at —
 *            with the icon plan, the splash mask, the appId and the generator's own source hash
 *            (`GENERATOR_FINGERPRINT`) folded in.
 *   outputs  a content hash of the files this function writes, as they are on disk.
 *
 * The outputs half is the whole safety argument, and it is why this is not the usual "trust a
 * cache" trade. It asks the honest question — *are the files I would write already the files
 * that are there?* — so every way of going wrong answers no and the work happens: a deleted
 * mipmap, a hand-edited icon, a half-written file from a Ctrl-C, a native project rescaffolded
 * by `cap add`, a `state.json` from another machine or none at all. It fails toward doing the
 * work, which is the only direction a build cache may fail in.
 *
 * `--force` bypasses it, like every other cache here.
 * @param {string} appRoot
 * @param {Record<string, any>} config
 * @param {string[]} platforms
 * @param {{ report?: (line: string) => void, force?: boolean }} [opts]
 */
export async function generateAssets(
  appRoot,
  config,
  platforms,
  { report, force = false } = {},
) {
  const icon = await resolveIconPlan()
  const mask = await resolveSplashMask(config)

  const inputs = createHash("sha1")
    .update(appConfigFingerprint(appRoot, config))
    .update(JSON.stringify(icon))
    .update(JSON.stringify(mask))
    .update(String(config?.appId))
    .update(`gen:${GENERATOR_FINGERPRINT}`)
    .digest("hex")
  const remembered = readSection(appRoot, "assets")

  const stale = platforms.filter(
    (p) =>
      force ||
      remembered[p]?.inputs !== inputs ||
      remembered[p]?.outputs !== assetOutputsHash(appRoot, p),
  )
  if (stale.length === 0) return

  if (stale.includes("android"))
    patchAndroidSplash(appRoot, mask, config.appId)
  if (stale.includes("ios")) patchIosTheme(appRoot, mask)

  //One scan for the whole run, even an `all` one: the same set brands both platforms, and
  //`preflight` has normally already resolved and reported on it before any of this ran.
  const set = await loadIconSet(appRoot, config)
  for (const platform of stale) {
    await brandLauncherIcon(nativeDir(appRoot, platform), platform, {
      set,
      background: icon.iconBackground,
      report,
    })
  }

  //Recorded AFTER writing, so the stored outputs hash describes what is now on disk.
  const next = { ...remembered }
  for (const p of stale)
    next[p] = { inputs, outputs: assetOutputsHash(appRoot, p) }
  writeSection(appRoot, "assets", next)
}

/**
 * Build the static SPA for the Capacitor target and stamp its `index.html`.
 *
 * `config` is not optional in practice: it carries the build id into the bundle's stamp
 * (`buildIdEnv`), which is what lets every later command tell a bundle built from the
 * config on disk from one built before the dev edited it.
 * @param {string} appRoot
 * @param {{ report?: (line: string) => void, config?: Record<string, any> }} [opts]
 */
export async function buildWeb(appRoot, { report, config } = {}) {
  //`building app` — the same phrase the iOS/Android package steps use, because from the
  //dev's side it is the same sentence: adaptv is building their app. The old text named
  //Capacitor and an internal env var, which R8/`opacity.mjs` forbid outright; it never
  //reached a terminal only because `prettyLine` was erasing it for an unrelated reason
  //(the parentheses), so a second bug was the only thing keeping the first one off screen.
  report?.("building app")
  const env = {
    ...process.env,
    ADAPTV_TARGET: "capacitor",
    ...(config ? await buildIdEnv(appRoot, config) : {}),
  }
  const vite = localBin(appRoot, "vite")
  if (vite) await run(vite, ["build"], { cwd: appRoot, env, report })
  else
    await run("npx", ["--yes", "vite", "build"], {
      cwd: appRoot,
      env,
      report,
    })

  // adaptv GENERATES this document (`src/vite/shell-emit.ts`) instead of
  // capturing whatever the build emitted, and the generated copy is the only one
  // carrying the prerendered boot fallback (`docs/decisions/register.md` B31). TanStack Start's
  // prerender also drops a `_shell.html` beside it — written ~1s LATER, measured —
  // and this step used to copy that over `index.html`. The two were byte-identical
  // then, so nothing broke; they are not any more (66 KB against 10 KB, measured
  // 2026-09-13), which is exactly the silent swap that "identical" was hiding, and
  // it would have landed precisely here: the native target, where a corrupt OTA
  // bundle is the failure the fallback exists to catch. So don't prefer it. Ours is
  // the shell, and the native prune now deletes theirs (`src/vite/native-bundle.ts`).
  const index = path.join(appRoot, CAP_WEB_DIR, "index.html")
  if (!existsSync(index)) {
    throw new Error(`the SPA build produced no ${CAP_WEB_DIR}/index.html`)
  }
}

/**
 * What `capAddIfMissing` throws when adaptv's own install has no iOS or Android platform
 * to scaffold from. adaptv ships `@capacitor/<platform>` as its OWN dependency and
 * resolves it from the framework, never from the app — so a miss here is an adaptv
 * packaging fault, and the sentence says so without naming the package: it lands on the
 * platform's `✖` line, and a line naming the engine underneath is the one thing that line
 * may never say (R8, L20). `doctor` reports the same fact the same way
 * (`install-report.mjs`).
 * @param {string} platform
 */
export const ownInstallMissingPlatform = (platform) =>
  `adaptv's own install has no ${platform} platform. Reinstall with 'pnpm install' ` +
  `(this is a framework packaging issue, not something to add to your app).`

/**
 * Scaffold the native project if it isn't there yet.
 *
 * The native project lives under `.adaptv/<platform>` and nowhere else. An `ios/` or
 * `android/` at the app root is not adaptv's — this once adopted one by moving it here,
 * as a migration from a layout adaptv itself used to scaffold, and that is a
 * compatibility shim for an install that has never existed (adaptv is unpublished, and
 * carries none: `cli-parse.mjs`, `app-config.ts` `ROUTER_BUILD_KEYS`). A directory the
 * dev put there is left exactly where they put it.
 * @param {string} appRoot
 * @param {string} platform
 * @param {NodeJS.ProcessEnv} env
 * @param {{ report?: (line: string) => void, plugins?: string[], privacy?: object }} [opts]
 */
export async function capAddIfMissing(
  appRoot,
  platform,
  env,
  { report, plugins, privacy } = {},
) {
  const dir = nativeDir(appRoot, platform)
  if (existsSync(dir)) {
    // Project already scaffolded — but still verify adaptv's plugins are declared in it (and,
    // on iOS, that the CocoaPods sandbox is in sync). This has to happen on EVERY prepare, not
    // only when the project is created: `cap sync` is skipped by the build cache on an
    // unchanged run, so a project left half-installed (Ctrl-C during CocoaPods → `Pods/` with
    // no lockfiles) would otherwise never be repaired and every build would fail with "The
    // sandbox is not in sync with the Podfile.lock" — and an Android project generated before
    // adaptv injected its plugins would keep building without them. Cheap when healthy: a few
    // stats and a string compare, then an early return.
    if (platform === "ios") {
      await injectIosPluginPods(appRoot, env, { report, plugins })
      await stampIosPrivacyManifest(appRoot, { plugins, privacy })
    } else {
      injectAndroidPluginProjects(appRoot, { report, plugins })
      await stampAndroidSdkLevels(appRoot)
    }
    return
  }

  // adaptv ships @capacitor/<platform> as its OWN dependency — resolve it from the
  // framework, not the app. If it's missing here, that's an adaptv packaging bug, not
  // something the consumer can fix.
  let platformInstalled = false
  for (const base of [ADAPTV_ROOT, appRoot]) {
    try {
      createRequire(path.join(base, "package.json")).resolve(
        `@capacitor/${platform}/package.json`,
      )
      platformInstalled = true
      break
    } catch {}
  }
  if (!platformInstalled)
    throw new Error(ownInstallMissingPlatform(platform))
  // Phrased as a SUB-ACTION, not a step: this now reports onto the platform's own line
  // (`ios` / `android`), so it has to read like something that line is doing right now —
  // and never name `cap`, which is adaptv's plumbing, not the dev's concern.
  //`preparing` is the phase every live row opens on, and ` · first run` is R25 metadata on
  //it — which is the only part the dev cannot already see (this is the wait that takes
  //minutes). The old text carried the same meaning in a shape `prettyLine` throws away:
  //parentheses are not in the phrase alphabet, so the row said nothing for the whole
  //`cap add` + CocoaPods scaffold.
  report?.("preparing · first run")
  const { cmd, pre } = capCmd(appRoot)
  //iOS: force CocoaPods, never SPM (SPM's binary xcframework fails to compile the
  //plugin sources under Xcode 16; CocoaPods builds from source, BUILD SUCCEEDED).
  const pkgMgr =
    platform === "ios" ? ["--packagemanager", "CocoaPods"] : []
  await run(cmd, [...pre, "add", platform, ...pkgMgr], {
    cwd: appRoot,
    env: withLiveCapConfig(env),
    report,
  })
  //`cap add` writes a core-only project (Capacitor can't discover adaptv's plugins) — a
  //Podfile on iOS, the Gradle/registry trio on Android. Inject now so a first run that
  //skips the (cached) sync still gets them.
  if (platform === "ios") {
    await injectIosPluginPods(appRoot, env, { report, plugins })
    await stampIosPrivacyManifest(appRoot, { plugins, privacy })
  } else {
    injectAndroidPluginProjects(appRoot, { report, plugins })
    await stampAndroidSdkLevels(appRoot)
  }
}

/**
 * The Android SDK levels adaptv ships, written into the project it owns.
 *
 * On EVERY android prepare, not only the scaffold: the project is written once and then
 * persists, so a template bump or a requirement bump in adaptv would otherwise reach a new
 * project and never an existing one — and the level Google Play gates on (36 since
 * 2026-08-31) was nobody's, inherited from the template by whichever version scaffolded
 * the project. The numbers live in `src/native/android-sdk.ts`, reached the way
 * `themeColors` reaches the config resolver; `doctor` reads the same file with the same
 * module, so the two can never disagree about what the level is.
 *
 * Silent, in both outcomes (R18): an unchanged file is not rewritten (`writeIfChanged` —
 * this file feeds the native build's own up-to-date checks), and a raised one is adaptv
 * handling adaptv's value, which is not the dev's concern and has no phrase in the
 * closed vocabulary. A project without the file is a shape this does not know and is
 * left alone.
 * @param {string} appRoot
 */
async function stampAndroidSdkLevels(appRoot) {
  const file = path.join(nativeDir(appRoot, "android"), "variables.gradle")
  if (!existsSync(file)) return
  const { stampAndroidSdkLevels: stamp } = await loadAdaptvModule(
    "native/android-sdk.ts",
  )
  writeIfChanged(file, stamp(readFileSync(file, "utf8")))
}

/** The packages adaptv ships that carry NATIVE code for `platform` — every plugin, plus
 * (on iOS) `@capacitor/ios` for the core pods. Derived from adaptv's own manifest so it
 * can never drift from what's installed. Excludes the JS-only core and the CLI.
 *
 * NOTE: membership is decided by inspecting the package, never by its name. This used
 * to filter on the `@capacitor/` prefix, which silently scoped adaptv to one vendor: a
 * plugin from anywhere else — `@capawesome/capacitor-live-update`, the OTA mechanism —
 * compiled fine and then never registered, surfacing at runtime as "plugin is not
 * implemented" with nothing in the build to explain it. */
export function adaptvCapacitorNativePkgs(platform) {
  const pkg = JSON.parse(
    readFileSync(path.join(ADAPTV_ROOT, "package.json"), "utf8"),
  )
  const skip = new Set([
    "@capacitor/cli",
    "@capacitor/core",
    "@capacitor/android",
  ])
  if (platform === "android") skip.add("@capacitor/ios")

  // `@capacitor/ios` is the PLATFORM, not a plugin: it declares no `capacitor`
  // field and has no `ios/` source dir, so the native-code test below says no —
  // correctly, and uselessly, because its pods are what the core builds from.
  // Forced in by name for that reason. Android's runtime is not, and must not be:
  // cap writes `include ':capacitor-android'` into `capacitor.settings.gradle`
  // itself, so adding it here would declare the same Gradle module twice.
  const forced = platform === "ios" ? "@capacitor/ios" : null

  const req = createRequire(path.join(ADAPTV_ROOT, "package.json"))
  const dirOf = (name) => {
    try {
      return path.dirname(req.resolve(`${name}/package.json`))
    } catch {
      return null
    }
  }

  return Object.keys(pkg.dependencies ?? {}).filter(
    (n) => !skip.has(n) && (n === forced || carriesNativeCode(dirOf(n))),
  )
}

/**
 * Does this package contribute code to the native binary?
 *
 * IMPORTANT: mirrors `carriesNativeCode` in `src/native/installed-plugins.ts` — the
 * same question, asked by the OTA fingerprint. The two answers have to agree:
 * a plugin this says yes to and the fingerprint says no to is native code the
 * compatibility gate cannot see changing, and the reverse is a bundle allowed to
 * call a plugin that was never compiled in. `native-plugin-discovery.test.mjs`
 * runs both over adaptv's real dependencies and fails if they diverge.
 *
 * It is duplicated rather than imported because every caller here is synchronous
 * and the TS module is only reachable through the async `loadAdaptvModule`.
 *
 * The test is what the native tooling itself keys on: a `capacitor` field (how a
 * plugin declares itself) AND a real platform source dir. Both, not either —
 * `@capacitor/cli` has neither, and a random package can ship an `ios/` folder of
 * screenshots.
 */
function carriesNativeCode(dir) {
  if (!dir) return false
  let pkg
  try {
    pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"))
  } catch {
    return false
  }
  if (pkg.capacitor === undefined) return false
  return (
    existsSync(path.join(dir, "ios")) ||
    existsSync(path.join(dir, "android"))
  )
}

/** Resolve a package directory for the native injectors. adaptv's OWN plugins resolve from
 * the framework; consumer-registered extras (adaptv.config.ts `plugins`) resolve from the
 * app, where the consumer `pnpm add`ed them. Tries both roots so either location works.
 *
 * Exported for `preflight.mjs`, which asks the SAME question before the run starts: is every
 * name in `plugins` installed? Sharing the resolver is what makes the two answers one answer
 * (R39) — preflight refuses exactly the names an injector would have had to skip, so the
 * check can never come to a different conclusion than the code it is protecting. */
export function pkgDirResolver(appRoot) {
  const reqAdaptv = createRequire(path.join(ADAPTV_ROOT, "package.json"))
  const reqApp = createRequire(path.join(appRoot, "package.json"))
  return (name) => {
    for (const req of [reqApp, reqAdaptv]) {
      try {
        return path.dirname(req.resolve(`${name}/package.json`))
      } catch {}
    }
    return null
  }
}

/** Scan a plugin package's iOS sources for its registered class name(s) — mirrors
 * @capacitor/cli's `findPluginClasses` (`@objc(Name)` for Swift, `CAP_PLUGIN(Name` for
 * ObjC). These are the entries the runtime needs in `packageClassList` to REGISTER a plugin. */
function scanIosPluginClasses(pluginDir) {
  const names = []
  const stack = [path.join(pluginDir, "ios")]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) stack.push(p)
      else if (e.name.endsWith(".swift") || e.name.endsWith(".m")) {
        const src = readFileSync(p, "utf8")
        for (const re of [
          /@objc\(([A-Za-z0-9_-]+)\)/,
          /CAP_PLUGIN\(([A-Za-z0-9_-]+)/,
        ]) {
          const m = src.match(re)
          if (m && !names.includes(m[1])) names.push(m[1])
        }
      }
    }
  }
  return names
}

/** Add class names to the native project's `packageClassList` (the runtime plugin registry).
 * `cap sync` rebuilds it from the app's DISCOVERED plugins only — adaptv's plugins aren't app
 * deps, so without this they compile but never register ("<X> plugin is not implemented"). */
function addToIosPackageClassList(appRoot, classNames) {
  if (classNames.length === 0) return
  const file = path.join(
    nativeDir(appRoot, "ios"),
    "App",
    "App",
    "capacitor.config.json",
  )
  if (!existsSync(file)) return
  const cfg = JSON.parse(readFileSync(file, "utf8"))
  const existing = cfg.packageClassList ?? []
  const merged = mergeClassList(existing, classNames)
  if (!classListChanged(existing, merged)) return
  cfg.packageClassList = merged
  writeFileSync(file, `${JSON.stringify(cfg, null, "\t")}\n`)
}

/** Stable 24-hex-char object ids, Xcode's format — regenerated identically every run. */
const pbxId = (seed) =>
  createHash("sha1").update(seed).digest("hex").slice(0, 24).toUpperCase()

const PRIVACY_MANIFEST = "PrivacyInfo.xcprivacy"

/**
 * Apple's required-reason API manifest, written into the iOS project and declared in it.
 *
 * **Why the CLI does this and not just the Vite plugin.** The plugin stamps the manifest
 * during the capacitor web build, and on a FIRST run that build happens before `cap add`
 * creates the project — so the stamper found no `.adaptv/ios/App`, skipped, and the app
 * shipped without a manifest. It appeared only on the second build, which is the worst kind
 * of bug: correct on the machine that has built twice, missing on CI and on a new clone.
 * Here the project is guaranteed to exist, so this is the run that counts; the Vite call
 * stays because it keeps the file current when only the config changed.
 *
 * Writing it is half the job — see {@link mergePbxprojResource} for the other half.
 * @param {string} appRoot
 * @param {{ plugins?: string[], privacy?: object }} [opts]
 */
async function stampIosPrivacyManifest(
  appRoot,
  { plugins, privacy } = {},
) {
  const { stampPrivacyManifest } = await loadAdaptvModule(
    "native/stamp-privacy.ts",
  )
  //ADAPTV_ROOT explicitly: this module is bundled into a `data:` URL by load-ts.mjs, so it
  //cannot locate adaptv from its own import.meta.url
  stampPrivacyManifest(appRoot, {
    plugins,
    privacy,
    adaptvRoot: ADAPTV_ROOT,
  })

  const pbxproj = path.join(
    nativeDir(appRoot, "ios"),
    "App/App.xcodeproj/project.pbxproj",
  )
  if (!existsSync(pbxproj)) return
  const src = readFileSync(pbxproj, "utf8")
  writeIfChanged(
    pbxproj,
    mergePbxprojResource(src, {
      name: PRIVACY_MANIFEST,
      fileType: "text.xml",
      buildFileId: pbxId("adaptv:privacy-manifest:build-file"),
      fileRefId: pbxId("adaptv:privacy-manifest:file-ref"),
    }),
  )
}

/**
 * Capacitor discovers plugins from the CONSUMER's `package.json` — but adaptv owns
 * the plugins (they're adaptv's deps, not the app's), so `cap sync` only ever writes
 * the core pod into the Podfile. adaptv owns the native project, so it injects its own
 * plugin pods here — resolved from adaptv's install, keyed by each package's
 * `.podspec` — then re-runs `pod install`. Runs after every sync (which regenerates
 * the Podfile), so it is self-healing rather than a one-time patch.
 * @param {string} appRoot
 * @param {NodeJS.ProcessEnv} env
 * @param {{ report?: (line: string) => void, plugins?: string[] }} [opts]
 */
async function injectIosPluginPods(
  appRoot,
  env,
  { report, plugins = [] } = {},
) {
  const podfile = path.join(nativeDir(appRoot, "ios"), "App", "Podfile")
  if (!existsSync(podfile)) return
  const resolvePkgDir = pkgDirResolver(appRoot)
  const podfileDir = path.dirname(podfile)
  const pods = []
  const seen = new Set()
  const classNames = []
  const { packages, extras } = resolvePluginPackages(
    adaptvCapacitorNativePkgs("ios"),
    plugins,
  )
  for (const name of packages) {
    //Silent when it does not resolve: `preflight` asked this exact question, with this
    //exact resolver, and ended the run before anything was scaffolded (R33/R18). Nothing
    //reaches here with a name it could report.
    const dir = resolvePkgDir(name)
    if (!dir) continue
    const rel = path.relative(podfileDir, dir)
    for (const spec of readdirSync(dir).filter((f) =>
      f.endsWith(".podspec"),
    )) {
      const podName = spec.replace(/\.podspec$/, "")
      //the package list is already deduped (resolvePluginPackages); this catches the rarer
      //case of two DIFFERENT packages shipping a podspec under the same name
      if (seen.has(podName)) continue
      seen.add(podName)
      pods.push(`  pod '${podName}', :path => '${rel}'`)
    }
    //@capacitor/ios is the core runtime, not a registrable plugin — skip it here.
    if (name !== "@capacitor/ios")
      for (const cn of scanIosPluginClasses(dir))
        if (!classNames.includes(cn)) classNames.push(cn)
  }
  //ALWAYS re-assert the runtime registry (cap rewrites it from app deps each sync), even when
  //the Podfile is unchanged — otherwise adaptv's plugins compile but don't register.
  addToIosPackageClassList(appRoot, classNames)
  if (pods.length === 0) return
  const src = readFileSync(podfile, "utf8")
  const next = src.replace(
    /def capacitor_pods[\s\S]*?\n\s*end/,
    `def capacitor_pods\n${pods.join("\n")}\nend`,
  )
  // Run `pod install` when the Podfile changed OR when the sandbox is out of sync with it.
  // The second case is not theoretical: a Ctrl-C (or a killed run) during CocoaPods leaves
  // `Pods/` behind without its lockfiles, and every later xcodebuild then hard-fails with
  // "The sandbox is not in sync with the Podfile.lock" — a dead end the dev can only escape
  // by running `pod install` by hand. Since adaptv owns this project, it repairs it instead.
  const changed = next !== src
  if (
    !podsNeedInstall({
      podfileChanged: changed,
      hasPodfileLock: existsSync(path.join(podfileDir, "Podfile.lock")),
      hasManifestLock: existsSync(
        path.join(podfileDir, "Pods", "Manifest.lock"),
      ),
    })
  )
    return
  if (changed) writeFileSync(podfile, next)
  //Say SOMETHING is being wired only when the CONSUMER registered a plugin (adaptv.config.ts
  //`plugins`) — the base set adaptv ships is framework plumbing, and a dev reading this
  //shouldn't have to know adaptv wires Capacitor pods at all (R8/L20).
  //The names used to be listed (`linking plugins · device`), which is R22's identifier in a
  //phase; which plugin is being linked is a `--verbose` question.
  //`extras`, not `plugins`: a config that lists a plugin adaptv already bundles has caused no
  //linking, and saying otherwise is a line about work that did not happen.
  if (extras.length > 0) report?.("linking plugins")
  await run("pod", ["install"], { cwd: podfileDir, env, report })
}

/** Scan an Android plugin's sources for the class the bridge must register — mirrors
 * @capacitor/cli's `findAndroidPluginClassesInPlugin`: the first `@CapacitorPlugin` /
 * `@NativePlugin` class in a `.java`/`.kt` file, qualified by that file's `package`. */
function scanAndroidPluginClasses(srcMainDir) {
  const out = []
  const stack = [srcMainDir]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        stack.push(p)
        continue
      }
      if (!e.name.endsWith(".java") && !e.name.endsWith(".kt")) continue
      const src = readFileSync(p, "utf8")
      const cls = src.match(
        /^@(?:CapacitorPlugin|NativePlugin)[\s\S]+?class ([\w]+)/m,
      )
      if (!cls) continue
      const pkg = src.slice(0, cls.index).match(/^package ([\w.]+);?$/m)
      if (!pkg) continue
      const classpath = `${pkg[1]}.${cls[1]}`
      if (!out.includes(classpath)) out.push(classpath)
    }
  }
  return out
}

/**
 * The Android half of the same problem `injectIosPluginPods` solves — and it was failing
 * silently in the worse direction. Capacitor discovers plugins from the CONSUMER's
 * `package.json` dependencies, and adaptv's plugins are adaptv's dependencies, so cap wrote
 * a project containing only whatever `@capacitor/*` the app happened to declare itself. iOS
 * never showed it because adaptv had already been injecting the Podfile; Android had no
 * equivalent, so 12 of 13 plugins were absent from the build and every native capability
 * quietly fell back to its web behaviour (no haptics, no native KV, no hardware back
 * button, no status-bar styling).
 *
 * Three files, because Android splits the job three ways — see the note in
 * `native-state.mjs`. All three are regenerated by every `cap sync`, so this runs after each
 * one and is self-healing rather than a one-time patch.
 *
 * NOT solved by `includePlugins` in the Capacitor config (which adaptv owns, and which would
 * be a one-line fix): cap resolves each named package from the APP root, and under pnpm
 * adaptv's plugins aren't reachable from there — it `fatal`s instead of syncing. It only
 * appears to work in this repo, where the playground sits inside adaptv's own tree and
 * Node's parent-directory walk finds them by accident of layout.
 *
 * Exported for `native-plugins.test.mjs`: of the two injectors this is the one that can run
 * against a scratch directory (it only writes files — iOS ends in `pod install`), so it is
 * where the shared plugin-set behaviour is asserted end to end.
 * @param {string} appRoot
 * @param {{ report?: (line: string) => void, plugins?: string[] }} [opts]
 */
export function injectAndroidPluginProjects(
  appRoot,
  { report, plugins = [] } = {},
) {
  const androidDir = nativeDir(appRoot, "android")
  const settings = path.join(androidDir, "capacitor.settings.gradle")
  const buildGradle = path.join(
    androidDir,
    "app",
    "capacitor.build.gradle",
  )
  if (!existsSync(settings) || !existsSync(buildGradle)) return
  const resolvePkgDir = pkgDirResolver(appRoot)
  const assets = path.join(
    androidDir,
    "app",
    "src",
    "main",
    "assets",
    "capacitor.plugins.json",
  )

  const entries = []
  const projects = []
  const classes = []
  const { packages, extras } = resolvePluginPackages(
    adaptvCapacitorNativePkgs("android"),
    plugins,
  )
  for (const name of packages) {
    //Same silence as iOS, for the same reason: `preflight` refused the run over any name
    //that does not resolve, so this branch is only ever the unreachable tail of a shared
    //resolver, never a fact the dev still needs to be told (R18).
    const dir = resolvePkgDir(name)
    if (!dir) continue
    // `capacitor.android.src` is where the plugin keeps its Gradle module; a package
    // without it has no Android half (an iOS-only plugin) and is not ours to declare.
    const meta = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    )
    const src = meta.capacitor?.android?.src
    if (!src) continue
    const project = gradleProjectName(name)
    //as on iOS: the package list is already deduped, so this is the two-different-packages,
    //one-module-name case
    if (projects.includes(project)) continue
    projects.push(project)
    entries.push({
      project,
      //Gradle reads this file on Windows too, and `new File()` there takes the unix form.
      dir: path
        .relative(androidDir, path.join(dir, src))
        .split(path.sep)
        .join("/"),
    })
    for (const cp of scanAndroidPluginClasses(
      path.join(dir, src, "src", "main"),
    ))
      classes.push({ pkg: name, classpath: cp })
  }
  if (projects.length === 0) return

  writeIfChanged(
    settings,
    mergeSettingsGradle(readFileSync(settings, "utf8"), entries),
  )
  writeIfChanged(
    buildGradle,
    mergeCapacitorBuildGradle(readFileSync(buildGradle, "utf8"), projects),
  )
  //cap writes the registry itself, but only for the plugins it found — merge rather than
  //replace so a consumer-declared plugin keeps its entry. An unreadable one is rebuilt from
  //adaptv's set rather than crashing the run: a half-written registry is exactly the state a
  //Ctrl-C leaves behind, and it's this pass's job to repair the project, not to die on it.
  let existing = []
  try {
    if (existsSync(assets))
      existing = JSON.parse(readFileSync(assets, "utf8"))
  } catch {}
  mkdirSync(path.dirname(assets), { recursive: true })
  writeIfChanged(
    assets,
    `${JSON.stringify(mergePluginsJson(existing, classes), null, "\t")}\n`,
  )
  //Same rule as iOS: adaptv's base set is plumbing the dev never asked for and must not be
  //told about (R8/L20). Only a plugin the CONSUMER registered — and that adaptv did not
  //already ship — is worth a word.
  if (extras.length > 0) report?.("linking plugins")
}

/**
 * `cap sync <platform>` (copies web assets + updates native deps).
 * @param {string} appRoot
 * @param {string} platform
 * @param {NodeJS.ProcessEnv} env
 * @param {{ report?: (line: string) => void, plugins?: string[], privacy?: object }} [opts]
 */
export async function capSync(
  appRoot,
  platform,
  env,
  { report, plugins, privacy } = {},
) {
  const { cmd, pre } = capCmd(appRoot)
  await run(cmd, [...pre, "sync", platform], {
    cwd: appRoot,
    env: withLiveCapConfig(env),
    report,
  })
  //Capacitor's discovery can't see adaptv-owned plugins; adaptv adds them itself.
  if (platform === "ios") {
    await injectIosPluginPods(appRoot, env, { report, plugins })
    await stampIosPrivacyManifest(appRoot, { plugins, privacy })
  } else injectAndroidPluginProjects(appRoot, { report, plugins })
}
//^ Neither injector takes a `warnings` channel any more. The one thing they used to push
//onto it — a configured plugin that is not installed — is knowable from the dev's own files
//with no native project in sight, so it is `preflight`'s `✖` now and the run never reaches
//here with it unresolved (R33). Saying it from inside a lane was also the same fact twice on
//an `all` run, once per platform, for a fact that has no platform (R18/R21).

/**
 * A `PATH` shim that stops the iOS Simulator from stealing the dev's focus.
 *
 * adaptv never opens the Simulator itself during a build — Capacitor's `cap run ios` shells out
 * to `native-run`, which boots the device and then runs, verbatim,
 * `open <Xcode>/Applications/Simulator.app --args -CurrentDeviceUDID <udid>`. A bare `open`
 * ACTIVATES the app, so every rebuild yanked the whole screen away from whatever the dev was
 * typing in. That call is inside a dependency; there is no flag for it.
 *
 * So intercept it where it is actually resolved. `native-run` spawns `open` by NAME, looked up on
 * the PATH it inherits, so a directory of our own at the front of that PATH — holding a one-line
 * `open` that re-execs the real one with `-g` (launch WITHOUT bringing to the foreground) — turns
 * that one call into a background launch. Everything else `open` is asked to do passes straight
 * through untouched, and the shim is scoped to `cap run`'s environment, so it cannot leak into the
 * dev's shell.
 *
 * The result matches the Android emulator, which was always the quieter of the two: the window
 * appears, the app is fronted INSIDE the device, and which window has your keyboard stays the
 * dev's own business.
 */
const SIM_OPEN_SHIM = `#!/bin/sh
# adaptv: launch the iOS Simulator in the background instead of stealing the dev's focus.
# Every other 'open' is passed through exactly as given.
for arg in "$@"; do
  case "$arg" in
  Simulator|*Simulator.app*) exec /usr/bin/open -g "$@" ;;
  esac
done
exec /usr/bin/open "$@"
`

export function withBackgroundSimulator(env) {
  //macOS-only by construction (it re-execs /usr/bin/open), and iOS builds are macOS-only too.
  if (process.platform !== "darwin") return env
  try {
    //`tmpdir()` is per-user on macOS (/var/folders/…/T), so a fixed name is a private path
    //rather than a shared one anybody could plant an executable in.
    const dir = path.join(tmpdir(), "adaptv-open-shim")
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const shim = path.join(dir, "open")
    writeIfChanged(shim, SIM_OPEN_SHIM)
    chmodSync(shim, 0o755)
    return {
      ...env,
      PATH: `${dir}${path.delimiter}${env.PATH ?? process.env.PATH ?? ""}`,
    }
  } catch {
    //A shim we couldn't write is a Simulator that jumps to the front — an annoyance, not a
    //reason to fail a build the dev is waiting on. Run without it.
    return env
  }
}

/**
 * `cap run <platform> --target <id>` (build + install + launch).
 * @param {string} appRoot
 * @param {string} platform
 * @param {string} target
 * @param {NodeJS.ProcessEnv} env
 * @param {{ report?: (line: string) => void }} [opts]
 */
export async function capRun(
  appRoot,
  platform,
  target,
  env,
  { report } = {},
) {
  const { cmd, pre } = capCmd(appRoot)
  // `--no-sync`: `cap run` syncs → builds → deploys, but the caller ALWAYS runs `cap sync`
  // first (and caches it), so letting run sync again just copies the web assets + re-updates
  // plugins a second time — duplicate work AND a duplicate "updating plugins" line. Skip it;
  // build + deploy only.
  //
  // Do NOT terminate the app before building — that would kill it for the whole build (the
  // dev asked to rebuild, not to stare at a home screen for 15s). Build + install with the
  // current app still running; the caller relaunches ONCE at the end (only if it was
  // actually running) to load the fresh install.
  const args = [...pre, "run", platform, "--no-sync"]
  if (target) args.push("--target", target)
  const childEnv = withLiveCapConfig(env)
  await run(cmd, args, {
    cwd: appRoot,
    env: platform === "ios" ? withBackgroundSimulator(childEnv) : childEnv,
    report,
  })
}

/**
 * Run a short command and resolve `{ status, stdout }`. The async twin of `spawnSync`, for the
 * device probes and launches.
 *
 * Why this exists: the live rows are repainted by a timer, and `spawnSync` blocks Node's event
 * loop for its whole duration — so during a launch the timer cannot fire, the spinner freezes,
 * and on `dev all` the two platform lanes cannot overlap at all (iOS runs to completion, THEN
 * Android). Reported as a reload that sits on one stale frame while the app is already open on
 * the device. Nothing here needs to be synchronous; it only ever was by habit.
 *
 * Deliberately not `exec()` from `exec.mjs`: that one streams every line to a phase reporter and
 * keeps a failure tail, which is right for xcodebuild and gradle and pure overhead for
 * `simctl launch`. This wants the exit code and, sometimes, a line of stdout.
 * @param {string} command
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, encoding?: BufferEncoding }} [opts]
 */
function probe(command, args, { env, encoding = "utf8" } = {}) {
  return new Promise((resolve) => {
    let out = ""
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "ignore"],
    })
    child.stdout?.setEncoding(encoding)
    child.stdout?.on("data", (d) => {
      out += d
    })
    //Never rejects: every caller here asks a yes/no question about a device, and "the tool
    //isn't there" is a `no`, not an exception to handle at each site.
    child.on("error", () => resolve({ status: 1, stdout: "" }))
    child.on("close", (status) =>
      resolve({ status: status ?? 1, stdout: out }),
    )
  })
}

/**
 * Make sure the iOS Simulator's WINDOW exists, without touching which window has the keyboard.
 *
 * The fast paths (a cached install, the `r` reload) never run `cap run`, so nothing else would
 * start Simulator.app — and a device booted headlessly with `simctl boot` runs the app where
 * nobody can see it. `-g` is the whole point: launch it, leave it behind whatever the dev is
 * working in. It used to be a bare `open -a Simulator`, which ACTIVATES — so every rebuild and
 * every reload stole the screen mid-keystroke.
 *
 * iOS only, and deliberately so. The Android emulator has no `.app` to `open`, and neither adb
 * nor the emulator expose a "show this window" command — the only options are OS-specific
 * window-manager hacks (AppleScript on macOS, wmctrl on Linux, …) that need extra permissions,
 * which a framework has no business doing and which don't exist uniformly across the
 * Linux/Windows hosts where Android dev also runs. iOS now behaves the way Android always did:
 * the app is fronted INSIDE the device, and the desktop window is the dev's own to raise.
 */
export async function ensureDeviceWindow(platform, target, env) {
  if (await isPhysicalTarget(platform, target, env)) return
  if (platform === "ios") await probe("open", ["-g", "-a", "Simulator"])
}

/**
 * adb serials of every connected device/emulator (state `device`). Used so adb calls
 * target a specific `-s <serial>`: with more than one emulator running, a bare `adb`
 * command is ambiguous and fails — which silently breaks `adb reverse` (→ the emulator
 * can't reach the host, → black screen).
 */
export async function androidDevices(env) {
  const r = await probe("adb", ["devices"], { env })
  if (r.status !== 0 || !r.stdout) return []
  return r.stdout
    .split("\n")
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p.length >= 2 && p[1] === "device")
    .map((p) => p[0])
}

// A canonical simulator UUID: 8-4-4-4-12 hex. Physical iOS device udids don't match
// (they're 40-hex or the newer 8-16 `00008030-001A…` shape).
const IOS_SIM_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Is the resolved target a PHYSICAL device (vs a simulator/emulator)? This decides the
 * dev-server networking: a sim/emulator reaches the host over localhost (shared loopback /
 * `adb reverse`), a physical device needs the host's LAN IP.
 *
 * iOS: simulators have canonical UUID ids; anything else is a real device.
 * Android: booted emulators are `emulator-NNNN`, and an AVD *name* (e.g. `Pixel_10`) is a
 * not-yet-booted emulator — neither is a real device. A physical device is a serial that
 * shows up in `adb devices` and isn't `emulator-`-prefixed.
 */
export async function isPhysicalTarget(platform, id, env) {
  if (!id) return false
  //iOS answers from the id alone — no device call, so this stays instant for the common case.
  if (platform === "ios") return !IOS_SIM_UUID.test(id)
  return (
    (await androidDevices(env)).includes(id) && !id.startsWith("emulator-")
  )
}

// Virtual bridges / VPN / link-local interfaces that aren't a real LAN address.
const SKIP_IFACE =
  /^(lo|utun|tun|tap|ppp|docker|veth|vboxnet|bridge|llw|awdl|gif|stf|ap\d)/i

/**
 * Best-effort LAN IPv4 for external-device live-reload — the address a phone on the same
 * Wi-Fi uses to reach this machine. Prefers `en0` (typical Wi-Fi/Ethernet on macOS), then
 * other `enN`, skipping loopback, link-local (169.254.x), VPN and container bridges.
 * Returns null if nothing routable is found (caller errors with guidance).
 */
export function lanIp() {
  const rank = (name) => {
    if (name === "en0") return 0
    if (/^en\d+$/.test(name)) return 1 + Number(name.slice(2))
    return 100
  }
  const candidates = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    if (SKIP_IFACE.test(name)) continue
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue
      if (a.address.startsWith("169.254.")) continue
      candidates.push({ name, address: a.address })
    }
  }
  candidates.sort((a, b) => rank(a.name) - rank(b.name))
  return candidates[0]?.address ?? null
}

/**
 * Turn a known `cap run` / xcodebuild / gradle failure into actionable adaptv guidance — a
 * friendly one-liner plus fix steps — instead of a wall of raw build log. `text` is the
 * combined error message + captured output. Returns `{ msg, fix: [...] }`, or null when we
 * don't recognise it (the caller then falls back to the raw output). Pure + patterns-only,
 * so it's unit-tested without a device.
 */
export function explainLaunchFailure(platform, text = "") {
  const t = String(text)

  // Device the run targeted isn't in the current list (disconnected / locked / a stale
  // saved pick / an id that changed). Platform-agnostic.
  const invalid = t.match(/Invalid target ID:\s*([^\s.]+)/i)
  if (invalid)
    return {
      msg: `device "${invalid[1]}" isn't available right now`,
      fix: [
        "It's disconnected, locked, or a stale saved pick.",
        `Reconnect + unlock it, or run 'adaptv dev ${platform}' to pick from the current list.`,
      ],
    }

  if (platform === "ios") {
    // Xcode refuses EVERY iOS destination — simulators included — when the iOS platform
    // this Xcode build wants has not been downloaded. It says so only inside its inventory
    // of ineligible destinations, one 190-column brace-delimited record per device, and the
    // line it actually fails on names none of it ("Unable to find a destination matching the
    // provided destination specifier", "Found no destinations for the scheme 'App'"). So the
    // dev reads a destination error, having just picked a device off a list adaptv showed
    // them, and there is nothing on screen connecting the two (R61).
    //
    // The second fix line exists for exactly that: the picker was NOT wrong. Its list comes
    // from the simulator service — those devices exist, boot and run — while what a build
    // needs is a platform Xcode installs separately, and can be missing while every
    // simulator on the machine still works.
    const noPlatform = t.match(
      /\b(iOS(?: [\d.]+)?) is not installed\.\s*Please download and install the platform/i,
    )
    if (noPlatform)
      return {
        msg: `Xcode is missing the ${noPlatform[1]} platform`,
        fix: [
          "Install it with 'xcodebuild -downloadPlatform iOS', or from Xcode → Settings → Components.",
          "The simulators still boot without it. Only building needs it, which is why they were listed.",
        ],
      }
    if (
      /Unable to find a destination matching|Found no destinations for the scheme/i.test(
        t,
      )
    )
      return {
        msg: "Xcode has no iOS destination it can build for",
        fix: [
          "Install an iOS platform with 'xcodebuild -downloadPlatform iOS', or from Xcode → Settings → Components.",
          "A simulator that boots is not enough on its own: building needs that platform too.",
        ],
      }
    if (
      /requires a development team|Signing for .* requires|No signing certificate|Code Sign(ing)? Error/i.test(
        t,
      )
    )
      return {
        msg: "iOS code signing isn't set up for a device build",
        fix: [
          "open .adaptv/ios/App/App.xcworkspace → App target → Signing & Capabilities → pick your Team",
          "(add your Apple ID in Xcode → Settings → Accounts; a free one works)",
        ],
      }
    if (/Developer Mode|enable-developer-mode|DVTDeviceOperation/i.test(t))
      return {
        msg: "Developer Mode is off on the device",
        fix: [
          "On the iPhone: Settings → Privacy & Security → Developer Mode → On, then restart.",
        ],
      }
    if (/device is locked|please unlock|is locked/i.test(t))
      return {
        msg: "the device is locked",
        fix: ["Unlock it and keep it unlocked while installing."],
      }
    if (
      /Unable to install|failed to install|not eligible|ineligible/i.test(
        t,
      )
    )
      return {
        msg: "couldn't install on the device",
        fix: [
          "Unlock it and tap 'Trust' on the phone; after install, trust the cert under Settings → General → VPN & Device Management.",
        ],
      }
  }

  if (platform === "android") {
    if (
      /signatures do not match|INSTALL_FAILED_UPDATE_INCOMPATIBLE|INSTALL_FAILED_VERSION_DOWNGRADE/i.test(
        t,
      )
    )
      return {
        msg: "Android install blocked by a signature/version conflict",
        fix: ["Uninstall the app from the device, then re-run."],
      }
    if (/INSTALL_FAILED_INSUFFICIENT_STORAGE/i.test(t))
      return {
        msg: "the device is out of storage",
        fix: ["Free some space on the device and re-run."],
      }
    if (
      /no devices.{0,3}emulators found|no connected devices|device offline/i.test(
        t,
      )
    )
      return {
        msg: "no Android device or emulator is reachable",
        fix: [
          "Boot an emulator or connect a device (USB debugging on), then re-run.",
        ],
      }
  }

  return null
}

/**
 * The adb serial for the device `cap run --target <id>` means, or null if it can't be
 * pinned down.
 *
 * `--target` is an AVD NAME (e.g. `Pixel_10`), not a serial (`emulator-5554`), so any
 * per-device question has to be translated first. Getting this wrong is not academic:
 * checking "is the app installed" across ALL connected emulators means a second, idle
 * emulator that has never seen the app makes the answer `false` forever, and the run
 * cache can never hit. Returns null when ambiguous so callers fall back to the safe path.
 */
export async function androidSerialForTarget(target, env) {
  const serials = await androidDevices(env)
  if (serials.length === 0) return null
  if (serials.length === 1) return serials[0]
  if (!target) return null
  if (serials.includes(target)) return target // already a serial
  for (const s of serials) {
    const r = await probe("adb", ["-s", s, "emu", "avd", "name"], { env })
    const name = (r.stdout ?? "").split("\n")[0]?.trim()
    if (name && name === target) return s
  }
  return null
}

/**
 * Is the app ALREADY installed on the target device?
 *
 * The run cache can't be trusted on its own — it has no idea you wiped the simulator or
 * deleted the app from the launcher. This asks the device directly, which is cheap, and
 * is what makes "skip the build" safe rather than merely fast. Any doubt answers `false`
 * so the caller falls back to a full build; a wasted rebuild is free, a skipped one that
 * should have happened is a debugging nightmare.
 */
export async function isAppInstalled(appRoot, platform, target, env) {
  const appId = readAppId(appRoot)
  if (!appId) return false
  if (platform === "ios") {
    if (!target) return false
    const r = await probe("xcrun", [
      "simctl",
      "get_app_container",
      target,
      appId,
    ])
    return r.status === 0
  }
  if (platform === "android") {
    // Ask ONLY the device this run targets — see `androidSerialForTarget`.
    const serial = await androidSerialForTarget(target, env)
    if (!serial) return false
    const r = await probe(
      "adb",
      ["-s", serial, "shell", "pm", "list", "packages", appId],
      { env },
    )
    return r.status === 0 && (r.stdout ?? "").includes(`package:${appId}`)
  }
  return false
}

/** Is the app currently RUNNING on the target device (not merely installed)? */
export async function isAppRunning(appRoot, platform, target, env) {
  const appId = readAppId(appRoot)
  if (!appId) return false
  if (platform === "ios") {
    if (!target) return false
    const r = await probe("xcrun", [
      "simctl",
      "spawn",
      target,
      "launchctl",
      "list",
    ])
    return r.status === 0 && (r.stdout ?? "").includes(appId)
  }
  if (platform === "android") {
    const serial = await androidSerialForTarget(target, env)
    if (!serial) return false
    const r = await probe("adb", ["-s", serial, "shell", "pidof", appId], {
      env,
    })
    return r.status === 0 && (r.stdout ?? "").trim().length > 0
  }
  return false
}

/**
 * Launch an already-installed app WITHOUT building, syncing, or reinstalling.
 *
 * The fast path behind the run cache: in live-reload the binary is only a shell pointing
 * at the dev server, so when nothing native changed there is nothing to rebuild.
 *
 * Critically, an app that is ALREADY RUNNING is only brought to the front — never killed.
 * It has by then almost certainly reconnected on its own: the offline screen polls for
 * the dev server and navigates the moment it answers, so the user watches it go
 * "offline → live". Killing and relaunching on top of that produced a jarring second
 * reopen of an app that was already showing exactly what they wanted.
 *
 * (The old forced terminate existed to rescue a WebView left black by a launch with no
 * server. The offline screen + reconnect watchdog now cover that case, and `r` remains
 * the explicit escape hatch for a genuinely wedged app.)
 */
export async function launchInstalledApp(
  appRoot,
  platform,
  target,
  env,
  { restart = false } = {},
) {
  const appId = readAppId(appRoot)
  if (!appId) return false
  // NOT asked: whether the app is running. It used to be, to compute `restart || !running`
  // — but terminating a stopped app is a no-op, so the two branches converge and the whole
  // expression reduces to `restart`. The invariant above (a running app is re-fronted, never
  // killed) is unchanged and is now enforced by the shape of the code rather than by a
  // question that cost ~200ms on iOS, asked on top of the one the caller had already asked.
  //
  // `restart` forces a fresh start of an already-running app, so its WebView reloads
  // from the dev server — the cheap `r` reload (no native rebuild).
  if (platform === "ios") {
    if (!target) return false
    // `simctl launch` on a running app activates it in place; only a requested restart
    // needs a terminate first.
    if (restart)
      await probe("xcrun", ["simctl", "terminate", target, appId])
    const r = await probe("xcrun", ["simctl", "launch", target, appId])
    return r.status === 0
  }
  if (platform === "android") {
    const serial = await androidSerialForTarget(target, env)
    if (!serial) return false
    // Same rule, and the same reduction: the LAUNCHER intent alone re-fronts an existing
    // task without restarting it, and `am force-stop` on a stopped app is a no-op.
    if (restart)
      await probe(
        "adb",
        ["-s", serial, "shell", "am", "force-stop", appId],
        {
          env,
        },
      )
    const r = await probe(
      "adb",
      [
        "-s",
        serial,
        "shell",
        "monkey",
        "-p",
        appId,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
      ],
      { env },
    )
    return r.status === 0
  }
  return false
}

/** The effective app id (may be the `.dev` variant) from the env-carried config, or null. */
function readAppId(_appRoot) {
  return capConfigFromEnv()?.appId ?? null
}

/**
 * Read a file, apply one regex replacement, write back only if it changed.
 *
 * A file that is not there is left alone: the identity lands in whichever of the
 * project's files exist, and a project without one of them has nothing for that value
 * to land in. Every OTHER failure is raised. This used to swallow all of them, and a
 * file adaptv can see but cannot read or write is a bundle id or a display name that
 * quietly stays wrong — on a build the dev goes on to install, with nothing on screen
 * to say the project was never patched.
 */
function subInFile(appRoot, file, re, replacement) {
  const fault = (err) =>
    new Error(
      `could not write ${path.relative(appRoot, file)} (${err?.code ?? err?.message ?? err})`,
    )
  let before
  try {
    before = readFileSync(file, "utf8")
  } catch (err) {
    if (err?.code === "ENOENT") return
    throw fault(err)
  }
  const after = before.replace(re, replacement)
  if (after === before) return
  try {
    writeFileSync(file, after)
  } catch (err) {
    throw fault(err)
  }
}

/** `$` in a String.replace replacement is special ($1, $$…) — neutralise it for literals. */
const escDollar = (s) => s.replace(/\$/g, "$$$$")

/**
 * Patch the native project's INSTALL identity in place, idempotently. `dev` + `preview`
 * builds take `<appId>.dev` / "<name> (dev)" so they install ALONGSIDE a real release build
 * instead of overwriting it — and get their own storage sandbox (which is what stops a dev
 * session's leftover WebView state from surfacing in a release install); `build` uses the
 * release identity.
 *
 * The install id lives in the native project (iOS pbxproj bundle id, Android
 * `applicationId`), NOT capacitor.config.json — but the CLI's own install-detection + launch
 * read the ROOT capacitor.config.json appId (readAppId), and `cap sync` copies that file into
 * the native project, so it's kept in step too. The Android `namespace` / iOS code identity
 * stay on the base id (namespace = code package, applicationId = install identity — the two
 * are allowed to differ), so generated sources (MainActivity, R) never move.
 *
 * And the Android namespace is PINNED here, not just left alone. `cap add` derives the
 * scaffolded `namespace` from whatever appId is in the live env-config at that moment — and a
 * multi-platform prepare flips that to `.dev` (an earlier platform's own `patchNativeIdentity`
 * mutates the shared `process.env`) BEFORE Android is scaffolded, so the namespace can be born
 * `.dev`. When it is, the manifest's `.MainActivity` resolves to `<base>.dev.MainActivity` — the
 * bare Capacitor stub `cap add` writes — and adaptv's edge-to-edge MainActivity (generated into
 * the BASE package by `patchAndroidSplash`) never launches, so the app slides under the status
 * bar on old WebViews (`docs/roadmap/native-shell-plugin.md` §0.2). Reasserting `namespace = <baseId>` every prepare keeps
 * the two in the same package whatever `cap add` guessed, and self-heals a project already born
 * wrong.
 *
 * Replace-to-target regexes: whatever the files currently hold, they land on the intended
 * value — so switching variants (or re-running) is always safe.
 */
export function patchNativeIdentity(appRoot, config, platform, { dev }) {
  const baseId = config?.appId
  if (!baseId) return
  const baseName = config.appName ?? config.name ?? baseId
  const id = dev ? `${baseId}.dev` : baseId
  const name = dev ? `${baseName} (dev)` : baseName

  // Keep the env-carried config (read by readAppId + copied by `cap sync`) on the install id.
  updateCapacitorEnv({ appId: id, appName: name })

  const nd = nativeDir(appRoot, platform)
  if (platform === "ios") {
    // bundle id (Debug + Release configs) + the home-screen display name.
    subInFile(
      appRoot,
      path.join(nd, "App/App.xcodeproj/project.pbxproj"),
      /PRODUCT_BUNDLE_IDENTIFIER = [^;]+;/g,
      `PRODUCT_BUNDLE_IDENTIFIER = ${escDollar(id)};`,
    )
    subInFile(
      appRoot,
      path.join(nd, "App/App/Info.plist"),
      /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/,
      `$1${escDollar(name)}$2`,
    )
  } else {
    // namespace = the code package (MainActivity + R live here): ALWAYS the base id, never
    // `.dev`, so `.MainActivity` resolves to adaptv's edge-to-edge activity, not the stub.
    subInFile(
      appRoot,
      path.join(nd, "app/build.gradle"),
      /namespace\s*=\s*"[^"]*"/,
      `namespace = "${escDollar(baseId)}"`,
    )
    subInFile(
      appRoot,
      path.join(nd, "app/build.gradle"),
      /applicationId\s+"[^"]*"/,
      `applicationId "${escDollar(id)}"`,
    )
    const strings = path.join(nd, "app/src/main/res/values/strings.xml")
    subInFile(
      appRoot,
      strings,
      /(<string name="app_name">)[^<]*(<\/string>)/,
      `$1${escDollar(name)}$2`,
    )
    subInFile(
      appRoot,
      strings,
      /(<string name="title_activity_main">)[^<]*(<\/string>)/,
      `$1${escDollar(name)}$2`,
    )
  }
}

/**
 * Reload the Android app's WebView WITHOUT rebuilding — force-stop + relaunch on each
 * device. `cap run` resets the emulator's `adb reverse` while installing/launching, so
 * the app it just launched has no route to the dev server and shows a black WebView
 * with no JS to recover. After re-asserting the reverse, adaptv relaunches the app so it
 * loads with a working route. (iOS shares the host loopback — nothing to do there.)
 */
export async function relaunchAndroidApp(appRoot, env, target) {
  const appId = readAppId(appRoot)
  if (!appId) return
  // Only the device this run targets — never every connected emulator. A second, idle
  // emulator must not be force-stopped and relaunched. Fall back to all devices only when
  // the target can't be resolved (ambiguous), matching the prior best-effort behaviour.
  const serial = await androidSerialForTarget(target, env)
  const serials = serial ? [serial] : await androidDevices(env)
  for (const s of serials) {
    await probe("adb", ["-s", s, "shell", "am", "force-stop", appId], {
      env,
    })
    await probe(
      "adb",
      [
        "-s",
        s,
        "shell",
        "monkey",
        "-p",
        appId,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
      ],
      { env },
    )
  }
}

function firstExisting(paths) {
  return paths.find((p) => p && existsSync(p)) ?? null
}

/** ANDROID_HOME + a JDK for Gradle; explicit env wins. */
export function androidEnv() {
  const env = { ...process.env }
  env.ANDROID_HOME =
    env.ANDROID_HOME ??
    env.ANDROID_SDK_ROOT ??
    path.join(homedir(), "Library/Android/sdk")

  if (
    !env.JAVA_HOME ||
    !existsSync(path.join(env.JAVA_HOME, "bin/java"))
  ) {
    const jbr =
      "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    let javaHome = existsSync(path.join(jbr, "bin/java")) ? jbr : null
    if (!javaHome) {
      const r = spawnSync("/usr/libexec/java_home", [], {
        encoding: "utf8",
      })
      if (r.status === 0) javaHome = r.stdout.trim()
    }
    if (javaHome) env.JAVA_HOME = javaHome
  }
  if (
    !env.JAVA_HOME ||
    !existsSync(path.join(env.JAVA_HOME, "bin/java"))
  ) {
    throw new Error(
      "no JDK found. Install Android Studio (bundles one) or set JAVA_HOME.",
    )
  }
  env.PATH = `${path.join(env.ANDROID_HOME, "platform-tools")}:${env.PATH}`
  return env
}

/** LANG (CocoaPods on Ruby 3.4 needs UTF-8) + `pod` on PATH. */
export function iosEnv() {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env, LANG: process.env.LANG ?? "en_US.UTF-8" }
  const onPath = spawnSync("sh", ["-c", "command -v pod"], { env })
  if (onPath.status !== 0) {
    const gemRoot = path.join(homedir(), ".gem/ruby")
    const gemBins = existsSync(gemRoot)
      ? readdirSync(gemRoot).map((v) => path.join(gemRoot, v, "bin"))
      : []
    const dir = firstExisting(
      [...gemBins, "/opt/homebrew/bin", "/usr/local/bin"].map((d) =>
        path.join(d, "pod"),
      ),
    )
    if (dir) env.PATH = `${path.dirname(dir)}:${env.PATH}`
  }
  return env
}

export function platformEnv(platform) {
  return platform === "ios" ? iosEnv() : androidEnv()
}
