import { describe, expect, it } from "vitest"
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
  //RENDERING §3.1.2: the shell must be GENERATED, never captured from a
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
