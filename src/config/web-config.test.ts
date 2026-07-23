import { describe, expect, it } from "vitest"
import type { AdaptvAppConfig } from "#adaptv/config/app-config"
import {
  resolveWebConfig,
  staticHostFiles,
} from "#adaptv/config/web-config"

function config(extra: Partial<AdaptvAppConfig> = {}): AdaptvAppConfig {
  return {
    name: "Probe",
    description: "d",
    themeColor: { light: "#fff" },
    styles: "./src/styles/main.css",
    router: {
      routesDirectory: "./routes",
      routerConfig: "./routes.config.ts",
    },
    ...extra,
  } as AdaptvAppConfig
}

describe("resolveWebConfig — render default", () => {
  it("defaults to SSR", () => {
    //DECISIONS §6.3, on the asymmetry: defaulting to SPA silently kills SEO and
    //is discovered late (usually by someone else, in a search ranking);
    //defaulting to SSR costs one config flip, immediately, by the person who
    //wanted SPA. Cheap-to-correct beats cheap-to-run.
    expect(resolveWebConfig(config()).render).toBe("ssr")
  })

  it("honours an explicit web.render", () => {
    expect(
      resolveWebConfig(config({ web: { render: "spa" } })).render,
    ).toBe("spa")
  })

  it("still honours the legacy router.render, so apps keep building", () => {
    const legacy = config()
    legacy.router.render = "spa"
    expect(resolveWebConfig(legacy).render).toBe("spa")
  })

  it("lets the new block win over the legacy field", () => {
    const both = config({ web: { render: "ssr" } })
    both.router.render = "spa"
    expect(resolveWebConfig(both).render).toBe("ssr")
  })
})

describe("resolveWebConfig — the capacitor target is absolute (L12)", () => {
  it("forces SPA and disables the SW, whatever the config says", () => {
    //Not a default, an override. A Capacitor WebView loads on-device files: there
    //is no server to SSR, and a SW is impossible on iOS's custom-scheme origin,
    //pointless (the bundle is local) and actively breaks OTA.
    const resolved = resolveWebConfig(
      config({ web: { render: "ssr", sw: { enabled: true } } }),
      "capacitor",
    )
    expect(resolved.render).toBe("spa")
    expect(resolved.sw.enabled).toBe(false)
  })
})

describe("resolveWebConfig — service worker", () => {
  it("is enabled by default on web", () => {
    expect(resolveWebConfig(config()).sw.enabled).toBe(true)
  })

  it("precaches no documents by default", () => {
    //empty by default is a SAFETY property, not a performance default:
    //Cache Storage is per-origin, not per-user
    expect(resolveWebConfig(config()).sw.precacheDocuments).toEqual([])
  })

  it("defaults registration to prompt, never autoUpdate (B3)", () => {
    expect(resolveWebConfig(config()).sw.register).toBe("prompt")
  })

  it("maps legacy `sw: false` onto the block", () => {
    expect(resolveWebConfig(config({ sw: false })).sw.enabled).toBe(false)
  })
})

describe("resolveWebConfig — host", () => {
  it("defaults to node, the least surprising target", () => {
    expect(resolveWebConfig(config()).host).toBe("node")
  })

  it("passes an explicit host through", () => {
    expect(
      resolveWebConfig(config({ web: { host: "cloudflare" } })).host,
    ).toBe("cloudflare")
  })

  it("forces static when the target is capacitor", () => {
    expect(resolveWebConfig(config(), "capacitor").host).toBe("static")
  })
})

describe("staticHostFiles — what a static host actually needs", () => {
  //DECISIONS B26: nothing emitted these, so `host: "static"` was not deployable
  //as designed even though it was documented.
  const files = staticHostFiles("<!doctype html><html></html>")

  it("emits index.html, because Start only writes _shell.html", () => {
    //and Jekyll STRIPS `_`-prefixed files on GitHub Pages, while Cloudflare
    //Workers Assets looks for /index.html — so the shell is invisible to both
    expect(files["index.html"]).toBeTruthy()
  })

  it("emits 404.html so deep links work on a static host", () => {
    //a static host has no router: /settings is a 404 unless the shell is served
    //for it, and 404.html is the convention GitHub Pages and Netlify honour
    expect(files["404.html"]).toBe(files["index.html"])
  })

  it("emits .nojekyll, without which GitHub Pages eats the asset dir", () => {
    //Jekyll strips files and dirs beginning with `_`, which includes Vite's
    //own output in some configurations
    expect(files[".nojekyll"]).toBeDefined()
  })

  it("emits a SPA redirect rule for Netlify-style hosts", () => {
    expect(files._redirects).toContain("/*")
    expect(files._redirects).toContain("200")
  })
})
