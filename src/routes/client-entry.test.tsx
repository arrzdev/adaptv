import {
  createRootRoute,
  createRoute,
  createRouter,
  HeadContent,
  Outlet,
} from "@tanstack/react-router"
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
import { APP_ROOT_ID } from "#adaptv/shell/boot-fallback"
import { renderAppShell } from "#adaptv/vite/app-shell"

/*
 * The boot a document with no server render takes: the native bundle, a web
 * `render: "spa"` deploy, and an `ssr` app served its precached shell offline.
 *
 * Every one of them used to log React #418 on every launch, because the entry
 * HYDRATED a generated shell that by construction holds no app markup. React
 * recovered by throwing the attempt away and client rendering, so the app still
 * worked, and the error was filed as inherent. It was not: the recovery clears the
 * document exactly the way a fresh client root does, so a fresh client root is the
 * same boot without the failed pass or the error. → docs/design/rendering.md §3.1
 *
 * The oracle is where React reports it: a recoverable error lands on `window` as
 * an `error` event, the same event the shell's boot watchdog and any app
 * telemetry listen to. (A spy on `reportError` is NOT an oracle here — React binds
 * it when react-dom loads, before any test body runs. Tried: it stays empty while
 * the hydration error goes out.)
 */

const APP_TEXT = "the app rendered"

//the real module is `#adaptv-route-tree` + virtual config, neither of which a unit
//test has. What the entry needs from it is one router whose root route renders the
//whole `<html>` document, which is the shape `shell-layout.tsx` gives every app.
vi.mock("#adaptv/routes/router-entry", () => {
  const rootRoute = createRootRoute({
    head: () => ({ meta: [{ title: "Probe" }] }),
    component: () => (
      <html lang="en">
        <head>
          <HeadContent />
        </head>
        <body>
          <Outlet />
        </body>
      </html>
    ),
  })
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <p>{APP_TEXT}</p>,
  })
  return {
    getRouter: () =>
      createRouter({ routeTree: rootRoute.addChildren([index]) }),
  }
})

/** The generated shell, laid into the live document the way a browser parses it. */
function loadShell() {
  const html = renderAppShell({
    lang: "en",
    title: "Probe",
    criticalCss: "html{background:#fff}",
    headInitScript: "window.__probe=1",
    stylesHref: "/assets/main-abc123.css",
    entryHref: "/assets/client-def456.js",
  })
  document.documentElement.innerHTML = html
    .replace(/^[\s\S]*?<html[^>]*>/, "")
    .replace(/<\/html>\s*$/, "")
    //happy-dom really fetches a `<link>`, against a server that is not running
    .replace(/<link\b[^>]*>/g, "")
}

let reported: unknown[]
const onError = (event: ErrorEvent) => {
  reported.push(event.error ?? event.message)
}

beforeEach(() => {
  reported = []
  window.addEventListener("error", onError)
  //no server render: this is the document the capacitor bundle and a spa deploy load
  delete (window as { $_TSR?: unknown }).$_TSR
  window.history.replaceState(null, "", "/")
  loadShell()
})

afterEach(() => {
  window.removeEventListener("error", onError)
})

//client-entry boots at import, so the test has to import it, but not the graph under it:
//loaded here, under the hook's budget, that graph costs the test nothing. On a loaded 2-cpu
//host the same load took the whole 5s default in launch-height-boot
beforeAll(async () => {
  await Promise.all([
    import("@tanstack/react-start/client"),
    import("react-dom/client"),
    import("#adaptv/routes/router-entry"),
    import("#adaptv/shell/native-live-reload-client"),
  ])
}, 30_000)

describe("client entry — booting a shell with no server render", () => {
  it("renders the app over the shell without a hydration error", async () => {
    await import("#adaptv/routes/client-entry")

    //the boot renders in a later task: waited for, up to the test's own budget
    await waitFor(
      () => expect(document.body.textContent).toContain(APP_TEXT),
      { timeout: 4000 },
    )
    //the shell's scaffolding is gone — the app owns the document now
    expect(document.getElementById(APP_ROOT_ID)).toBeNull()
    //...except what paints before the bundle: the inlined critical CSS stays
    expect(document.head.querySelector("style")?.textContent).toContain(
      "html{background:#fff}",
    )
    //let React flush whatever it reports after the commit
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(reported.map(String)).toEqual([])
  })
})
