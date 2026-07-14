#!/usr/bin/env node
// The nativ CLI — owns the whole native (Capacitor) lifecycle so a consumer never
// touches Capacitor, the toolchain env, or the asset generator by hand:
//
//   nativ doctor              check the local toolchain (JDK, Android SDK, Xcode, pod)
//   nativ run ios|android     build the SPA → brand the icons/splash → sync → launch on a device/sim
//   nativ build android       assemble a debug APK
//   nativ build ios --ipa     archive an unsigned .ipa (for sideloading / re-signing)
//   nativ sync [ios|android]  build → brand assets → cap sync (no launch)
//   nativ assets [ios|android] regenerate launcher icons + splash from ./assets
//
// It resolves ANDROID_HOME / JAVA_HOME / pod / LANG itself (an explicit env var still
// wins), and invokes the local `cap` / `capacitor-assets` binaries directly — so it
// works from a bare shell, not only through a pnpm script that happens to seed PATH.
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import process from "node:process"
import { build as esbuild } from "esbuild"

const CWD = process.cwd()
const CAP_WEB_DIR = "dist-capacitor/client"

/* =============================================================================
 * tiny output helpers
 * ============================================================================= */

const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
}
const log = (s = "") => process.stdout.write(`${s}\n`)
const step = (s) => log(c.cyan(`→ ${s}`))
const ok = (s) => log(c.green(`✔ ${s}`))
const warn = (s) => log(c.yellow(`! ${s}`))
function die(message) {
  log(c.red(`✖ ${message}`))
  process.exit(1)
}

/* =============================================================================
 * config
 * ============================================================================= */

/**
 * Load `nativ.config.ts` as data (esbuild-bundled, dynamic imports left external
 * so the screen thunks never execute) — the CLI's single source of truth, same
 * file the vite plugin reads.
 */
async function loadConfig(appRoot) {
  const configPath = path.join(appRoot, "nativ.config.ts")
  if (!existsSync(configPath)) {
    die(`no nativ.config.ts in ${appRoot} — run from an app root.`)
  }
  const result = await esbuild({
    entryPoints: [configPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    plugins: [
      {
        name: "externalize-dynamic-imports",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) =>
            args.kind === "dynamic-import" ? { external: true } : null,
          )
        },
      },
    ],
  })
  const source = result.outputFiles?.[0]?.text
  if (!source) die("failed to bundle nativ.config.ts")
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  const mod = await import(url)
  const config = mod.default
  if (!config?.appId) {
    die("nativ.config.ts needs an `appId` for native builds.")
  }
  return config
}

/** Icon source dir + launcher-icon backing (icon only; the splash is colour-driven). */
function resolveIconPlan(config) {
  const theme = config.themeColor ?? {}
  const dark = theme.dark ?? theme.light ?? "#000000"
  return {
    dir: "./assets", //convention: assets/logo.png (transparent mark)
    iconBackground: "#ffffff",
    iconBackgroundDark: dark,
  }
}

/**
 * The launch-splash MASK — the flat colour the OS splash paints before the React
 * splash. Returns light + dark colours and a `follow`:
 *   - "preferences" → native override makes it follow the app theme (default)
 *   - "system"      → adaptive colours, no override (follows the device)
 *   - "none"        → fixed (both colours identical; theme-independent)
 */
function resolveSplashMask(config) {
  const theme = config.themeColor ?? {}
  const light =
    config.splashMaskLightColor ??
    config.backgroundColor ??
    theme.light ??
    theme.dark ??
    "#ffffff"
  const dark =
    config.splashMaskDarkColor ?? theme.dark ?? theme.light ?? "#000000"
  const mode = config.splashMaskMode ?? "preferences"
  if (mode === "light") return { light, dark: light, follow: "none" }
  if (mode === "dark") return { light: dark, dark, follow: "none" }
  if (mode === "system") return { light, dark, follow: "system" }
  return { light, dark, follow: "preferences" }
}

/* =============================================================================
 * process + binary resolution
 * ============================================================================= */

/** Run a command with inherited stdio; exit the CLI on failure. */
function sh(cmd, args, { cwd = CWD, env = process.env, label } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, stdio: "inherit" })
  if (r.status !== 0) {
    die(`${label ?? `${cmd} ${args.join(" ")}`} failed`)
  }
}

/** Path to a local `node_modules/.bin/<name>`, or null. */
function localBin(appRoot, name) {
  const p = path.join(appRoot, "node_modules", ".bin", name)
  return existsSync(p) ? p : null
}

/** Resolve `cap` (Capacitor CLI); prefer the local install, fall back to npx. */
function capCmd(appRoot) {
  const local = localBin(appRoot, "cap")
  return local
    ? { cmd: local, pre: [] }
    : { cmd: "npx", pre: ["--yes", "@capacitor/cli"] }
}

/* =============================================================================
 * toolchain env
 * ============================================================================= */

function firstExisting(paths) {
  return paths.find((p) => p && existsSync(p)) ?? null
}

/** ANDROID_HOME + a JDK for Gradle; explicit env wins. */
function androidEnv() {
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
    die(
      "no JDK found. Install Android Studio (bundles one) or set JAVA_HOME.",
    )
  }
  env.PATH = `${path.join(env.ANDROID_HOME, "platform-tools")}:${env.PATH}`
  return env
}

/** LANG (CocoaPods on Ruby 3.4 needs UTF-8) + `pod` on PATH. */
function iosEnv() {
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

function platformEnv(platform) {
  return platform === "ios" ? iosEnv() : androidEnv()
}

/* =============================================================================
 * pipeline steps
 * ============================================================================= */

/** Build the static SPA for the Capacitor target and stamp its `index.html`. */
function buildWeb(appRoot) {
  step("building SPA (NATIV_TARGET=capacitor)")
  const vite = localBin(appRoot, "vite")
  const env = { ...process.env, NATIV_TARGET: "capacitor" }
  if (vite) sh(vite, ["build"], { cwd: appRoot, env, label: "vite build" })
  else
    sh("npx", ["--yes", "vite", "build"], {
      cwd: appRoot,
      env,
      label: "vite build",
    })

  // TanStack Start emits `_shell.html`; Capacitor loads `index.html`.
  const shell = path.join(appRoot, CAP_WEB_DIR, "_shell.html")
  const index = path.join(appRoot, CAP_WEB_DIR, "index.html")
  if (existsSync(shell)) {
    copyFileSync(shell, index)
    ok(`SPA ready (${CAP_WEB_DIR}/index.html)`)
  } else if (existsSync(index)) {
    ok("SPA ready")
  } else {
    die(`SPA build produced no ${CAP_WEB_DIR}/_shell.html or index.html`)
  }
}

/**
 * Brand the launcher icons + splash from ./assets via @capacitor/assets. Skips
 * (with a hint) when the source art or the generator is absent — a native build
 * still works, it just keeps whatever icons are already in place.
 */
// ============================================================================
// Native splash = a flat MASK colour (no logo). Colour-DRIVEN, not image-driven:
// Android → a colour on the launch theme + a transparent icon; iOS → a colour asset
// on a solid launch storyboard. The mask follows the app theme, the device, or is
// fixed (see resolveSplashMask). Re-applied every sync (idempotent), survives a
// native re-scaffold. The mascot lives ONLY in the app's React splash.
// ============================================================================

const ANDROID_TRANSPARENT_ICON = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@android:color/transparent" />
</shape>
`
function androidColorsXml(hex) {
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="nativSplashBackground">${hex}</color>
</resources>
`
}
// Launch theme = flat colour, transparent icon. `platform=true` uses the API-31+
// `android:`-prefixed attrs (values-v31); false uses the AndroidX backport attrs (base).
function androidLaunchStyles(platform) {
  const p = platform ? "android:" : ""
  return `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:windowBackground">@color/nativSplashBackground</item>
        <item name="${p}windowSplashScreenBackground">@color/nativSplashBackground</item>
        <item name="${p}windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>
</resources>
`
}

// Plain MainActivity (used when the mask is fixed or follows the device — the colour
// resource resolves itself; no per-app override needed).
function androidMainActivityPlain(appId) {
  return `package ${appId};

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
`
}

// Themed MainActivity (mask follows the app PREFERENCE) — applies a per-app night mode
// from the persisted theme preference so the OS splash colour tracks the app theme, not
// the device. `UiModeManager.setApplicationNightMode` (API 31+) is the API the OS honours
// for the system splash; applied at startup AND live (a SharedPreferences listener), and
// it persists → the next launch's splash is already correct (1-launch, no "open twice").
function androidMainActivityThemed(appId) {
  return `package ${appId};

import android.app.UiModeManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import androidx.appcompat.app.AppCompatDelegate;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private SharedPreferences.OnSharedPreferenceChangeListener nativThemeListener;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        applyNativTheme(true);
        super.onCreate(savedInstanceState);
        // uiMode is in the activity's configChanges, so applying live does NOT reload
        // the WebView; kept as a field so the listener isn't garbage-collected.
        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        nativThemeListener = (sp, key) -> {
            if ("nativ-theme".equals(key)) {
                applyNativTheme(false);
            }
        };
        prefs.registerOnSharedPreferenceChangeListener(nativThemeListener);
    }

    // AppCompatDelegate only at startup (before super.onCreate) — calling it live
    // recreates the activity; the live path only touches UiModeManager.
    private void applyNativTheme(boolean atStartup) {
        SharedPreferences prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String pref = prefs.getString("nativ-theme", "system");
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
}
`
}

function patchAndroidSplash(appRoot, mask, appId) {
  const res = path.join(appRoot, "android/app/src/main/res")
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
  //own the base launch theme (replace the whole style; other styles untouched)
  const stylesPath = path.join(res, "values/styles.xml")
  if (existsSync(stylesPath)) {
    const base = `    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:windowBackground">@color/nativSplashBackground</item>
        <item name="windowSplashScreenBackground">@color/nativSplashBackground</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`
    const styles = readFileSync(stylesPath, "utf8").replace(
      /[ \t]*<style name="AppTheme\.NoActionBarLaunch"[\s\S]*?<\/style>/,
      base,
    )
    writeFileSync(stylesPath, styles)
  }
  //MainActivity: per-app night override ONLY when the mask follows the preference
  const javaDir = path.join(
    appRoot,
    "android/app/src/main/java",
    appId.replace(/\./g, "/"),
  )
  mkdirSync(javaDir, { recursive: true })
  writeFileSync(
    path.join(javaDir, "MainActivity.java"),
    mask.follow === "preferences"
      ? androidMainActivityThemed(appId)
      : androidMainActivityPlain(appId),
  )
  ok(
    `android splash → ${mask.follow === "none" ? "fixed" : mask.follow} colour (no icon)`,
  )
}

// ---- iOS: colour asset + solid-colour launch storyboard (no image) ----

function hexToRgb(hex) {
  const h = hex.replace("#", "")
  const n =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
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
  //a fixed mask has no dark variant → theme-independent (also kills the iOS
  //launch-storyboard first-frame flicker, since there's nothing to resolve).
  if (mask.follow !== "none") {
    colors.push({
      appearances: [{ appearance: "luminosity", value: "dark" }],
      color: color(mask.dark),
      idiom: "universal",
    })
  }
  return `${JSON.stringify({ colors, info: { author: "nativ", version: 1 } }, null, 2)}\n`
}

//solid-colour launch screen — a single view painted with the NativSplash colour asset.
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
                        <color key="backgroundColor" name="NativSplash"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
        </scene>
    </scenes>
    <resources>
        <namedColor name="NativSplash">
            <color red="${r}" green="${g}" blue="${b}" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
        </namedColor>
    </resources>
</document>
`
}

// iOS: colour-driven splash. Writes the NativSplash colour asset + a solid launch
// storyboard, and (only when the mask follows the app PREFERENCE) an AppDelegate
// override so the held splash + app track the pref. The very first storyboard frame is
// drawn pre-app and follows the device for adaptive masks — a fixed mask has no dark
// variant, so even that frame is exact.
function patchIosTheme(appRoot, mask) {
  const iosApp = path.join(appRoot, "ios/App/App")
  if (!existsSync(iosApp)) return
  const colorsetDir = path.join(
    iosApp,
    "Assets.xcassets/NativSplash.colorset",
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
  //AppDelegate override — present only when following the preference.
  const appDelegate = path.join(iosApp, "AppDelegate.swift")
  if (existsSync(appDelegate)) {
    let src = readFileSync(appDelegate, "utf8")
    //strip any prior nativ override (idempotent + handles a mode switch)
    src = src.replace(
      /\n +\/\/ nativ: follow the persisted[\s\S]*?\.unspecified\)/,
      "",
    )
    const marker =
      "// Override point for customization after application launch."
    if (mask.follow === "preferences" && src.includes(marker)) {
      src = src.replace(
        marker,
        `${marker}
        // nativ: follow the persisted app theme (not system) for the splash + app.
        let nativThemePref = UserDefaults.standard.string(forKey: "CapacitorStorage.nativ-theme") ?? "system"
        window?.overrideUserInterfaceStyle = nativThemePref == "dark" ? .dark : (nativThemePref == "light" ? .light : .unspecified)`,
      )
    }
    writeFileSync(appDelegate, src)
  }
  ok(
    `ios splash → ${mask.follow === "none" ? "fixed" : mask.follow} colour`,
  )
}

function generateAssets(appRoot, config, platforms) {
  const icon = resolveIconPlan(config)
  const mask = resolveSplashMask(config)
  //native splash mask (colour-driven) — independent of the icon generator, always apply.
  if (platforms.includes("android")) {
    patchAndroidSplash(appRoot, mask, config.appId)
  }
  if (platforms.includes("ios")) {
    patchIosTheme(appRoot, mask)
  }
  //launcher ICON — branded from ./assets/logo.png via @capacitor/assets.
  const dir = path.resolve(appRoot, icon.dir)
  const logo = path.join(dir, "logo.png")
  if (!existsSync(logo)) {
    warn(`no ${icon.dir}/logo.png — skipping launcher-icon generation.`)
    return
  }
  const bin = localBin(appRoot, "capacitor-assets")
  if (!bin) {
    warn(
      "@capacitor/assets not installed — skipping launcher-icon generation.",
    )
    warn("  add it: pnpm add -D @capacitor/assets")
    return
  }
  step("branding launcher icon from ./assets/logo.png")
  const args = [
    "generate",
    "--assetPath",
    icon.dir,
    "--iconBackgroundColor",
    icon.iconBackground,
    "--iconBackgroundColorDark",
    icon.iconBackgroundDark,
    //splash is colour-driven above; keep the generator happy + colour-consistent
    "--splashBackgroundColor",
    mask.light,
    "--splashBackgroundColorDark",
    mask.dark,
    ...platforms.flatMap((p) => [`--${p}`]),
  ]
  sh(bin, args, { cwd: appRoot, label: "capacitor-assets generate" })
  ok("launcher icon branded")
}

function capSync(appRoot, platform, env) {
  step(`cap sync ${platform}`)
  const { cmd, pre } = capCmd(appRoot)
  sh(cmd, [...pre, "sync", platform], {
    cwd: appRoot,
    env,
    label: `cap sync ${platform}`,
  })
}

function capRun(appRoot, platform, target, env) {
  step(`cap run ${platform}`)
  const { cmd, pre } = capCmd(appRoot)
  const args = [...pre, "run", platform]
  if (target) args.push("--target", target)
  sh(cmd, args, { cwd: appRoot, env, label: `cap run ${platform}` })
}

/* =============================================================================
 * commands
 * ============================================================================= */

function checkTool(label, argv, { optional = false } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8" })
  const found = r.status === 0
  const detail = found
    ? (r.stdout || r.stderr || "").trim().split("\n")[0]
    : ""
  log(
    `  ${found ? c.green("✔") : optional ? c.yellow("○") : c.red("✖")} ${label}${
      detail ? c.dim(`  ${detail}`) : ""
    }`,
  )
  return found
}

function doctor(appRoot) {
  log(c.bold("nativ doctor"))
  log(
    c.dim("  toolchain for building native iOS / Android from this app\n"),
  )

  log("Core")
  checkTool("node", ["node", "--version"])
  const { cmd, pre } = capCmd(appRoot)
  checkTool("capacitor cli", [cmd, ...pre, "--version"])

  log("\nAndroid")
  const aEnv = { ...process.env }
  const androidHome =
    aEnv.ANDROID_HOME ??
    aEnv.ANDROID_SDK_ROOT ??
    path.join(homedir(), "Library/Android/sdk")
  log(
    `  ${existsSync(androidHome) ? c.green("✔") : c.red("✖")} Android SDK${c.dim(`  ${androidHome}`)}`,
  )
  const jbr = "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  const jdk = firstExisting([
    aEnv.JAVA_HOME && path.join(aEnv.JAVA_HOME, "bin/java"),
    path.join(jbr, "bin/java"),
  ])
  log(
    `  ${jdk ? c.green("✔") : c.red("✖")} JDK${jdk ? c.dim(`  ${path.dirname(path.dirname(jdk))}`) : c.dim("  install Android Studio or set JAVA_HOME")}`,
  )
  checkTool(
    "adb",
    [path.join(androidHome, "platform-tools/adb"), "version"],
    {
      optional: true,
    },
  )

  log("\niOS (macOS only)")
  checkTool("xcodebuild", ["xcodebuild", "-version"], { optional: true })
  const ie = iosEnv()
  checkTool("cocoapods (pod)", ["pod", "--version"], { optional: true }) ||
    checkTool(
      "cocoapods (pod, resolved)",
      ["bash", "-lc", `PATH="${ie.PATH}" pod --version`],
      { optional: true },
    )

  log("\nPlugins (installed in this app — Capacitor auto-discovers them)")
  checkAppPlugins(appRoot)

  log("\nProject")
  log(
    `  ${existsSync(path.join(appRoot, "android")) ? c.green("✔") : c.yellow("○")} android/ project`,
  )
  log(
    `  ${existsSync(path.join(appRoot, "ios")) ? c.green("✔") : c.yellow("○")} ios/ project`,
  )
  log(
    `  ${existsSync(path.join(appRoot, "assets/logo.png")) ? c.green("✔") : c.yellow("○")} assets/logo.png (launcher-icon source)`,
  )
  log("")
}

// nativ's default hooks/primitives call these plugins (behind isNativePlatform
// guards). They must be DIRECT deps of the app — Capacitor only auto-discovers direct
// deps at `cap sync`, not transitive ones — so nativ declares them as optional peers
// and doctor flags any the consumer hasn't installed.
const NATIV_BASE_PLUGINS = [
  "@capacitor/app",
  "@capacitor/browser",
  "@capacitor/core",
  "@capacitor/geolocation",
  "@capacitor/haptics",
  "@capacitor/keyboard",
  "@capacitor/network",
  "@capacitor/preferences",
  "@capacitor/screen-orientation",
  "@capacitor/splash-screen",
  "@capacitor/status-bar",
]

function checkAppPlugins(appRoot) {
  const pkgPath = path.join(appRoot, "package.json")
  if (!existsSync(pkgPath)) {
    log(`  ${c.red("✖")} package.json not found`)
    return
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const missing = []
  for (const name of NATIV_BASE_PLUGINS) {
    const present = name in deps
    log(`  ${present ? c.green("✔") : c.red("✖")} ${name}`)
    if (!present) missing.push(name)
  }
  if (missing.length) {
    log(
      c.yellow(
        `\n  install the missing plugins so the native hooks work:`,
      ),
    )
    log(c.dim(`    pnpm --filter ${pkg.name} add ${missing.join(" ")}`))
  }
}

async function cmdSync(appRoot, platform) {
  const config = await loadConfig(appRoot)
  const env = platformEnv(platform)
  buildWeb(appRoot)
  generateAssets(appRoot, config, [platform])
  capSync(appRoot, platform, env)
  ok(`synced ${platform}`)
}

async function cmdRun(appRoot, platform, target) {
  const config = await loadConfig(appRoot)
  const env = platformEnv(platform)
  buildWeb(appRoot)
  generateAssets(appRoot, config, [platform])
  capSync(appRoot, platform, env)
  capRun(appRoot, platform, target, env)
}

async function cmdAssets(appRoot, platform) {
  const config = await loadConfig(appRoot)
  const platforms = platform ? [platform] : ["ios", "android"]
  generateAssets(appRoot, config, platforms)
}

async function cmdBuild(appRoot, platform, flags) {
  const config = await loadConfig(appRoot)
  const env = platformEnv(platform)
  buildWeb(appRoot)
  generateAssets(appRoot, config, [platform])
  capSync(appRoot, platform, env)

  if (platform === "android") {
    step("assembling debug APK")
    sh(path.join(appRoot, "android/gradlew"), ["assembleDebug"], {
      cwd: path.join(appRoot, "android"),
      env,
      label: "gradle assembleDebug",
    })
    ok("APK → android/app/build/outputs/apk/debug/app-debug.apk")
    return
  }

  // iOS: only the unsigned .ipa path is automatable (signing stays the user's).
  if (!flags.ipa) {
    die(
      "`nativ build ios` needs --ipa (unsigned archive). Signed builds: Xcode ▸ Archive.",
    )
  }
  const script = path.join(appRoot, "scripts/build-ipa.sh")
  if (!existsSync(script)) die("scripts/build-ipa.sh not found.")
  step("archiving unsigned .ipa")
  sh("bash", [script], { cwd: appRoot, env, label: "build-ipa" })
}

/* =============================================================================
 * dispatch
 * ============================================================================= */

function usage() {
  log(`${c.bold("nativ")} — native (Capacitor) lifecycle for a nativ app

${c.bold("Usage")}
  nativ doctor
  nativ run <ios|android> [--target <id>]
  nativ build <android> | build ios --ipa
  nativ sync [ios|android]
  nativ assets [ios|android]

${c.dim("Toolchain env (ANDROID_HOME / JAVA_HOME / pod / LANG) is auto-resolved.")}`)
}

function parseFlags(argv) {
  const flags = {}
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--target") flags.target = argv[++i]
    else if (a === "--ipa") flags.ipa = true
    else if (a.startsWith("--")) flags[a.slice(2)] = true
    else rest.push(a)
  }
  return { flags, rest }
}

function assertPlatform(p) {
  if (p !== "ios" && p !== "android") {
    die(`unknown platform "${p ?? ""}" — expected ios or android.`)
  }
  return p
}

async function main() {
  const [command, ...raw] = process.argv.slice(2)
  const { flags, rest } = parseFlags(raw)
  const appRoot = CWD

  switch (command) {
    case "doctor":
      return doctor(appRoot)
    case "run":
      return cmdRun(appRoot, assertPlatform(rest[0]), flags.target)
    case "build":
      return cmdBuild(appRoot, assertPlatform(rest[0]), flags)
    case "sync":
      return cmdSync(appRoot, assertPlatform(rest[0] ?? "android"))
    case "assets":
      return cmdAssets(
        appRoot,
        rest[0] ? assertPlatform(rest[0]) : undefined,
      )
    case undefined:
    case "help":
    case "--help":
    case "-h":
      return usage()
    default:
      log(c.red(`unknown command: ${command}\n`))
      usage()
      process.exit(1)
  }
}

main().catch((err) => die(err?.message ?? String(err)))
