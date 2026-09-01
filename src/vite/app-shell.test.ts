import { describe, expect, it } from "vitest"
import {
  BOOT_CODES,
  BOOT_FALLBACK_ID,
  getBootFallbackCss,
} from "#adaptv/shell/boot-fallback"
import { renderAppShell } from "#adaptv/vite/app-shell"

const opts = {
  lang: "en",
  title: "Probe",
  criticalCss: "html{background:#fff}",
  headInitScript: "window.__x=1",
  stylesHref: "/assets/main-abc123.css",
  entryHref: "/assets/client-def456.js",
  headExtra: '<link rel="manifest" href="/manifest.json">',
}

describe("renderAppShell — user-agnostic by construction", () => {
  //`docs/design/rendering.md` §3.1.2: the shell must be GENERATED, never captured from a
  //response. A captured document is whatever the server rendered for whoever
  //triggered the build — user-specific by construction, and it would be cached
  //and served to everyone. Generating it makes the property structural rather
  //than something you have to remember.
  it("contains no app content — only the boot scaffolding", () => {
    const html = renderAppShell(opts)
    //the root is empty: React fills it after the client entry runs
    expect(html).toMatch(/<div id="root"><\/div>/)
  })

  it("carries the pre-paint init script BEFORE the stylesheet", () => {
    //the platform/theme stamp has to land before first paint, or the app: / web:
    //variants and the splash policy resolve on the wrong frame and flash
    const html = renderAppShell(opts)
    expect(html.indexOf("window.__x=1")).toBeLessThan(
      html.indexOf("main-abc123.css"),
    )
  })

  it("inlines the critical CSS rather than linking it", () => {
    //a linked stylesheet is a round trip before first paint; the whole point of
    //critical CSS is that it is already there
    expect(renderAppShell(opts)).toContain("html{background:#fff}")
  })

  it("links the app stylesheet and the client entry", () => {
    const html = renderAppShell(opts)
    expect(html).toContain("/assets/main-abc123.css")
    expect(html).toContain("/assets/client-def456.js")
  })

  it("loads the entry as a module", () => {
    expect(renderAppShell(opts)).toContain('type="module"')
  })

  it("sets the document language and title", () => {
    const html = renderAppShell(opts)
    expect(html).toContain('lang="en"')
    expect(html).toContain("<title>Probe</title>")
  })

  it("carries viewport-fit=cover, which Capacitor hard-gates on", () => {
    //Capacitor checks the viewport meta LITERALLY contains `viewport-fit=cover`
    //before it will report safe-area insets at all
    expect(renderAppShell(opts)).toContain("viewport-fit=cover")
  })

  it("includes extra head markup verbatim", () => {
    expect(renderAppShell(opts)).toContain('rel="manifest"')
  })

  it("escapes the title, so an app name cannot break the document", () => {
    const html = renderAppShell({ ...opts, title: "A <b>& B" })
    expect(html).toContain("A &lt;b&gt;&amp; B")
    expect(html).not.toContain("<b>&")
  })

  it("is stable across renders — a changing shell breaks precache revisions", () => {
    expect(renderAppShell(opts)).toBe(renderAppShell(opts))
  })
})

describe("renderAppShell — the boot error fallback", () => {
  const FALLBACK =
    '<div data-adaptv="boot-error">Something went wrong</div>'
  //a component that ignores `code` renders the same string for every one, which
  //is exactly what collapses the four variants back to a single copy
  const withFallback = {
    ...opts,
    bootFallbackByCode: Object.fromEntries(
      Object.values(BOOT_CODES).map((code) => [code, FALLBACK]),
    ),
  }

  it("embeds the prerendered screen, hidden", () => {
    //`docs/design/rendering.md` §3.1.3: the one screen that has to survive its own build being
    //broken, so it ships as markup rather than as anything the bundle produces
    const html = renderAppShell(withFallback)
    expect(html).toContain(FALLBACK)
    expect(html).toContain(`id="${BOOT_FALLBACK_ID}" hidden`)
  })

  it("arms the watchdog in the HEAD, before the entry script", () => {
    //a script that fails to LOAD fires its error event on the element; a listener
    //registered afterwards never sees it. Order here is the whole mechanism.
    const html = renderAppShell(withFallback)
    expect(html.indexOf(BOOT_FALLBACK_ID)).toBeLessThan(
      html.indexOf("client-def456.js"),
    )
    expect(html.indexOf("</head>")).toBeGreaterThan(
      html.indexOf("MutationObserver"),
    )
  })

  it("inlines the fallback's own CSS, which cannot depend on the stylesheet", () => {
    //if the bundle is broken the stylesheet may be missing too; the screen still
    //has to be a readable, full-viewport surface
    expect(renderAppShell(withFallback)).toContain(getBootFallbackCss())
  })

  it("emits nothing at all when there is no fallback to embed", () => {
    //a failed prerender must leave the shell exactly as it was, not half-wired
    const html = renderAppShell(opts)
    expect(html).not.toContain(BOOT_FALLBACK_ID)
    expect(html).not.toContain("MutationObserver")
  })

  it("stays deterministic with the fallback in place", () => {
    expect(renderAppShell(withFallback)).toBe(renderAppShell(withFallback))
  })
})
