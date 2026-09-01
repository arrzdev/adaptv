import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  APP_ROOT_ID,
  BOOT_CODES,
  BOOT_FAILED_ATTR,
  BOOT_FALLBACK_ID,
  BOOT_GRACE_MS,
} from "#adaptv/shell/boot-fallback"
import { renderAppShell } from "#adaptv/vite/app-shell"
import { prerenderBootFallback } from "#adaptv/vite/boot-fallback-prerender"

/*
 * The whole thing, end to end, on the exact failure it was built for: **a bundle
 * that passed the build and dies on the first load.**
 *
 * Every other test in this feature covers one layer. This one takes the real
 * prerendered component, puts it in the real emitted document, runs the real
 * inline watchdog, kills the entry script, and asserts on what a user would be
 * looking at. Nothing here is a stand-in.
 * → docs/design/rendering.md §3.1.3
 */

const ENTRY = "/assets/client-def456.js"

/** Mount the emitted document and run its inline scripts, the way a browser does. */
function loadDocument(html: string) {
  //innerHTML never executes scripts, so they are collected and evaluated in
  //document order afterwards — which is exactly the ordering guarantee the
  //watchdog depends on (it must arm before the entry script is reached)
  document.documentElement.innerHTML = html
    .replace(/^[\s\S]*?<html[^>]*>/, "")
    .replace(/<\/html>\s*$/, "")
    //`<link>`s are dropped, not stubbed: happy-dom really fetches them, against a
    //dev server that is not running, and the rejections land after the test ends.
    //Nothing here asserts on computed styles — the styling claim this file makes
    //is about which CLASSES ship, which is a markup question.
    .replace(/<link\b[^>]*>/g, "")

  for (const script of document.querySelectorAll("script")) {
    if (!script.getAttribute("src") && script.textContent) {
      new Function(script.textContent)()
    }
  }
}

/** The entry `<script src>` failing to fetch — a 404, a pruned deploy, no network. */
function breakTheEntryScript() {
  const entry = document.querySelector(`script[src="${ENTRY}"]`)
  entry?.dispatchEvent(new Event("error"))
}

const fallback = () => document.getElementById(BOOT_FALLBACK_ID)
const onScreen = () =>
  fallback()?.hasAttribute("hidden") === false
    ? (fallback()?.textContent ?? "")
    : ""

let html: string

beforeEach(async () => {
  vi.useFakeTimers()
  html ??= renderAppShell({
    lang: "en",
    title: "Probe",
    criticalCss: "html{background:#fff}",
    //deliberately inert: the real platform/theme stamp is tested elsewhere and
    //would only add noise to what this file is about
    headInitScript: "window.__probe=1",
    stylesHref: "/assets/main-abc123.css",
    entryHref: ENTRY,
    bootFallbackByCode: await prerenderBootFallback({
      appRoot: process.cwd(),
      specifier: null,
    }),
  })
  loadDocument(html)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.documentElement.innerHTML = ""
  document.documentElement.removeAttribute(BOOT_FAILED_ATTR)
})

describe("a bundle that built fine and dies on first load", () => {
  it("shows nothing while the app still has a chance to boot", () => {
    //the fallback ships in every document; it must be invisible on the happy path
    expect(onScreen()).toBe("")
  })

  it("puts the app's error screen on a WebView that would have gone blank", () => {
    breakTheEntryScript()

    const screen = onScreen()
    expect(screen).toContain("Couldn't load the app")
    expect(screen).toContain("Try again")
  }, 60_000)

  it("names the failure on the document, and never on the screen", () => {
    breakTheEntryScript()

    //one attribute read for telemetry or an e2e assertion, no scraping — while
    //the screen itself stays adaptv-neutral, because whether a code helps a user
    //or just alarms them is the app's call, not the framework's
    expect(document.documentElement.getAttribute(BOOT_FAILED_ATTR)).toBe(
      BOOT_CODES.load,
    )
    expect(onScreen()).not.toContain(BOOT_CODES.load)
  })

  it("distinguishes a broken file from one that never arrived", () => {
    //same blank screen, different culprit: BOOT-LOAD is a deploy or CDN problem,
    //BOOT-THROW means the file arrived and the code in it is broken. An app that
    //overrides `bootErrorScreen` gets this as a prop and can say so.
    window.dispatchEvent(new Event("error"))
    expect(document.documentElement.getAttribute(BOOT_FAILED_ATTR)).toBe(
      BOOT_CODES.throw,
    )
  })

  it("catches the silent death, where nothing is ever raised", () => {
    vi.advanceTimersByTime(BOOT_GRACE_MS + 1)
    expect(document.documentElement.getAttribute(BOOT_FAILED_ATTR)).toBe(
      BOOT_CODES.stall,
    )
    expect(onScreen()).toContain("Couldn't load the app")
  })

  it("carries the app's real styling, not a framework-flavoured screen", () => {
    //the point of prerendering the COMPONENT rather than hand-writing an HTML
    //page: what ships is the app's own markup, Tailwind classes and all, from a
    //stylesheet that is a different file from the JS that broke
    breakTheEntryScript()

    const root = fallback()?.querySelector('[data-adaptv="boot-error"]')
    expect(root).not.toBeNull()
    expect(root?.className).toContain("flex")
  })

  it("stands down the moment the app proves it can render", () => {
    //a slow boot that eventually wins must not be left under an error screen
    vi.advanceTimersByTime(BOOT_GRACE_MS + 1)
    expect(onScreen()).not.toBe("")

    document
      .getElementById(APP_ROOT_ID)
      ?.appendChild(document.createElement("main"))

    return Promise.resolve().then(() => {
      expect(onScreen()).toBe("")
    })
  })

  it("offers the only action that can help — a reload", () => {
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })
    breakTheEntryScript()
    ;(
      fallback()?.querySelector("[data-adaptv-boot-retry]") as HTMLElement
    ).click()

    expect(reload).toHaveBeenCalledOnce()
  })
})
