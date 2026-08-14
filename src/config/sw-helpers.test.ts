import { describe, expect, it } from "vitest"
import {
  appShellFile,
  DEFAULT_SW_GLOB_IGNORES,
  DEFAULT_SW_GLOB_PATTERNS,
  SPA_APP_SHELL_FILE,
  SSR_APP_SHELL_FILE,
} from "#adaptv/config/sw-helpers"

/**
 * These pin the two halves of one decision that had no test and was broken in
 * both directions at once: the shell MUST be precached, and route documents must
 * NOT be. → `RENDERING.md §3.2`
 */
describe("precache glob — the shell is in, documents are out", () => {
  it.each(["ssr", "spa"] as const)(
    "precaches the %s app shell by name",
    (render) => {
      //Load-bearing, not cosmetic. The navigation route BINDS to this file:
      //without it in the manifest, ssr silently falls through to the browser's
      //error page offline, and spa throws `non-precached-url` at worker
      //evaluation so no service worker installs at all.
      const patterns = [...DEFAULT_SW_GLOB_PATTERNS, appShellFile(render)]
      expect(patterns).toContain(appShellFile(render))
    },
  )

  it("never sweeps html in with a wildcard", () => {
    //A `**/*.html` here would pull in every prerendered route document. Under
    //SSR those are per-request and carry a session, while Cache Storage is keyed
    //by URL and scoped per-ORIGIN — so one user's page is served to the next.
    //The shell is the single exception because it is generated and identical for
    //everybody, which is why it is named rather than matched.
    for (const pattern of DEFAULT_SW_GLOB_PATTERNS) {
      expect(pattern).not.toContain("html")
    }
  })

  it("keeps the worker and its intermediate bundle out of its own manifest", () => {
    expect(DEFAULT_SW_GLOB_IGNORES).toContain("sw.js")
    expect(DEFAULT_SW_GLOB_IGNORES).toContain("sw-src.js")
  })
})

describe("appShellFile — the SSR shell must not be a directory index", () => {
  it("uses index.html for spa", () => {
    //Nothing competes for `/` in a SPA build, and a static host needs the shell
    //under exactly this name for deep links to resolve.
    expect(appShellFile("spa")).toBe("index.html")
    expect(SPA_APP_SHELL_FILE).toBe("index.html")
  })

  it("does NOT use index.html for ssr", () => {
    //The regression this pins, MEASURED on Cloudflare Workers Assets: the client
    //output dir IS the assets root, assets are served before the worker runs, and
    //`index.html` is the directory index for `/`. So the home route of an SSR app
    //silently returned the 3 079-byte shell instead of a 76 741-byte server
    //render — correct-looking output with no SSR and no SEO, and no error
    //anywhere. Vercel resolves static before functions the same way.
    expect(appShellFile("ssr")).not.toBe("index.html")
    expect(SSR_APP_SHELL_FILE).toBe("adaptv-shell.html")
  })

  it("never prefixes the shell with an underscore", () => {
    //GitHub Pages runs Jekyll, which STRIPS `_`-prefixed files — which is how
    //Start's own `_shell.html` became invisible there in the first place.
    expect(SSR_APP_SHELL_FILE.startsWith("_")).toBe(false)
    expect(SPA_APP_SHELL_FILE.startsWith("_")).toBe(false)
  })

  it("keeps the shell matchable by the precache glob's extension set", () => {
    //Both names must stay `.html`: the shell is appended to the glob by name, and
    //a name the manifest cannot resolve produces a worker that fails only at
    //runtime, offline.
    expect(SPA_APP_SHELL_FILE.endsWith(".html")).toBe(true)
    expect(SSR_APP_SHELL_FILE.endsWith(".html")).toBe(true)
  })
})
