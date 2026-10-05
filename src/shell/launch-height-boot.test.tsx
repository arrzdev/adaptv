import { waitFor } from "@testing-library/react"
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { getLaunchViewportInitScript } from "#adaptv/shell/launch-viewport"
import { renderAppShell } from "#adaptv/vite/app-shell"

/*
 * The launch height through a boot with no server render: an `ssr` app served its
 * precached shell offline, every launch of a `render: "spa"` deploy.
 *
 * That boot is a fresh client root over the document (`client-entry.tsx`), and React
 * clears every attribute of `<html>` when it takes the element over, the inline
 * `style` the pre-paint script wrote `--pwa-launch-height` into included. The
 * server-rendered page hydrates instead and keeps it. So the splash, which React
 * paints in that same commit, fell back to the app's own height. On the iOS 26.1
 * simulator, an instrumented production build of the playground at #247's head,
 * installed and launched offline, put the mascot at 368pt, where its online
 * launches put it at 337pt.
 *
 * The root route here is adaptv's own, with its built-in document, because the
 * shell layout inside it is what has to put the height back.
 */

vi.mock("#adaptv/routes/router-entry", async () => {
  const { createRoute } = await import("@tanstack/react-router")
  const { PwaSplashOverlay } = await import(
    "#adaptv/components/pwa-splash-overlay"
  )
  const { createAdaptvRouter } = await import(
    "#adaptv/shell/create-adaptv-router"
  )
  const { createRootRoute } = await import(
    "#adaptv/shell/create-root-route"
  )
  const rootRoute = createRootRoute({
    title: "Probe",
    themeColorLight: "#ffffff",
    themeColorDark: "#000000",
    splashScreenComponent: () => (
      <PwaSplashOverlay>booting</PwaSplashOverlay>
    ),
  })
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>the app rendered</p>,
  })
  return {
    getRouter: () =>
      createAdaptvRouter({ routeTree: rootRoute.addChildren([index]) }),
  }
})

const root = document.documentElement

/** The shell's head script, run as an iOS Home Screen app runs it: 812pt shown. */
function runLaunchScript() {
  const matchMedia = window.matchMedia
  window.matchMedia = ((query: string) => ({
    matches: query === "(display-mode: standalone)",
  })) as typeof window.matchMedia
  Object.defineProperty(window.navigator, "standalone", {
    configurable: true,
    value: true,
  })
  //happy-dom lays nothing out: every probe reads the height the page shows, and the
  //top inset probe reads it too, so innerHeight plus the inset is never a shrink
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockReturnValue({ height: 812 } as DOMRect)
  new Function(getLaunchViewportInitScript())()
  rect.mockRestore()
  window.matchMedia = matchMedia
}

beforeEach(() => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(new Response("{}", { status: 200 })),
  )
  delete (window as { $_TSR?: unknown }).$_TSR
  window.history.replaceState(null, "", "/")
  const html = renderAppShell({
    lang: "en",
    title: "Probe",
    criticalCss: "html{background:#fff}",
    headInitScript: "",
    stylesHref: "/assets/main-abc123.css",
    entryHref: "/assets/client-def456.js",
  })
  root.innerHTML = html
    .replace(/^[\s\S]*?<html[^>]*>/, "")
    .replace(/<\/html>\s*$/, "")
    //happy-dom really fetches a `<link>`, against a server that is not running
    .replace(/<link\b[^>]*>/g, "")
  runLaunchScript()
})

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window.navigator, "standalone")
})

//client-entry boots at import, so the test has to import it, but not the graph under it:
//loaded here, under the hook's budget, that graph costs the test nothing. On a loaded 2-cpu
//host it took the whole 5s default inside the test
beforeAll(async () => {
  await Promise.all([
    import("@tanstack/react-start/client"),
    import("react-dom/client"),
    import("#adaptv/routes/router-entry"),
    import("#adaptv/shell/native-live-reload-client"),
  ])
}, 30_000)

//one boot per file: client-entry boots at import and the module cache keeps it, so a
//second test here needs `vi.resetModules()`
describe("the launch height — a boot with no server render", () => {
  it("is on <html> when the client root inserts the splash", async () => {
    expect(root.style.getPropertyValue("--pwa-launch-height")).toBe(
      "812px",
    )

    //read when the splash is inserted: a MutationObserver callback runs in the
    //commit's own task, after its layout effects, so in a browser before a paint.
    //A restore deferred to a later task still leaves the height in place by the
    //time a plain waitFor reads it
    const atInsert: string[] = []
    const observer = new MutationObserver(() => {
      if (
        atInsert.length === 0 &&
        document.querySelector("[data-adaptv-splash]")
      )
        atInsert.push(root.style.getPropertyValue("--pwa-launch-height"))
    })
    observer.observe(document, { childList: true, subtree: true })

    await import("#adaptv/routes/client-entry")

    //the boot renders in a later task: waited for, up to the test's own budget
    await waitFor(() => expect(atInsert).toHaveLength(1), {
      timeout: 4000,
    })
    observer.disconnect()
    expect(atInsert[0]).toBe("812px")
  })
})
