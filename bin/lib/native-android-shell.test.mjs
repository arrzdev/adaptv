import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ADAPTV_DIR } from "./adaptv-dir.mjs"
import { patchAndroidSplash } from "./native.mjs"

// The generated MainActivity is the ONLY thing that puts an Android app under the system
// bars — nothing in Capacitor asks for it below API 35 (NATIVE-SHELL §0.0). Each
// expectation below is a symptom measured on a Pixel 7 emulator (API 34, WebView 113),
// so a change that drops one has to argue with the screenshot.

const APP_ID = "dev.arrz.example"
const MASK = { light: "#eeeeec", dark: "#0a0a0c", follow: "preferences" }

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true })
})

/** A native project skeleton with just enough of it for the patcher to find. */
function project(mask = MASK) {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-android-"))
  dirs.push(appRoot)
  const android = path.join(appRoot, ADAPTV_DIR, "android")
  mkdirSync(path.join(android, "app/src/main/res/values"), {
    recursive: true,
  })
  patchAndroidSplash(appRoot, mask, APP_ID)
  return readFileSync(
    path.join(
      android,
      "app/src/main/java",
      APP_ID.replace(/\./g, "/"),
      "MainActivity.java",
    ),
    "utf8",
  )
}

describe("generated MainActivity — Android edge-to-edge", () => {
  // the report: "on older androids (Pixel 7) the app is not rendering edge-to-edge".
  // Android 15+ enforces it; below that this call is the only thing that ever asks.
  it("asks for edge-to-edge on every API level, for BOTH bars", () => {
    expect(project()).toContain(
      "WindowCompat.setDecorFitsSystemWindows(getWindow(), false)",
    )
  })

  // the theme-less variant (splashMaskMode other than "preferences") is a different
  // template and used to be an empty class — it needs the shell too.
  it("is in the plain variant as well as the themed one", () => {
    const plain = project({ ...MASK, follow: "system" })
    expect(plain).toContain("adaptvEdgeToEdge()")
    expect(plain).not.toContain("AppCompatDelegate")
  })

  // after super.onCreate: the bridge is built there, and installing our inset listener
  // after SystemBars loaded its own is what leaves exactly one on the view.
  it("runs after super.onCreate, so the bridge exists and our listener wins", () => {
    const src = project()
    expect(src.indexOf("super.onCreate(savedInstanceState)")).toBeLessThan(
      src.indexOf("adaptvEdgeToEdge()"),
    )
  })

  // WebView < 140 makes SystemBars inject `0px` for all four insets on purpose. Drawing
  // under the bars with zeros is the app header landing on top of the clock.
  it("takes the insets over only below Capacitor's WebView 140 cutoff", () => {
    const src = project()
    expect(src).toContain("ADAPTV_WEBVIEW_WITH_SAFE_AREA_FIX = 140")
    expect(src).toContain(
      "if (adaptvWebViewMajorVersion() >= ADAPTV_WEBVIEW_WITH_SAFE_AREA_FIX) return",
    )
  })

  // the same four properties SystemBars writes, on the same element — safe-area.css
  // consumes them var-first and must not be able to tell which side produced a pass.
  it("writes the contract's own variables", () => {
    const src = project()
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(src).toContain(`'--safe-area-inset-${side}'`)
    }
    expect(src).toContain("document.documentElement.style")
  })

  // crbug/461332423 — CONSUMED breaks the WebView's safe-area recalculation, which is
  // why Capacitor builds zeroed insets instead. Ours must not regress to CONSUMED.
  it("never returns WindowInsetsCompat.CONSUMED", () => {
    expect(project()).not.toContain("return WindowInsetsCompat.CONSUMED")
  })

  // the IME resizes the view; padding for the gesture bar on top of that counts it twice
  it("drops the bottom inset while the keyboard is up", () => {
    expect(project()).toContain(
      "int bottom = keyboardVisible ? 0 : bars.bottom",
    )
  })
})
