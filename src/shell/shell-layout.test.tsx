import {
  createMemoryHistory,
  createRoute,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { act, render, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { useEffect } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PwaSplashOverlay } from "#adaptv/components/pwa-splash-overlay"
import type { SplashScreenProps } from "#adaptv/config/types"
import { createBootstrapGate } from "#adaptv/hooks/create-bootstrap-gate"
import { createAdaptvRouter } from "#adaptv/shell/create-adaptv-router"
import { createRootRoute } from "#adaptv/shell/create-root-route"

// A cold start into a route that does not exist used to leave the splash pinned
// over the app forever: the not-found boundary is root, so nothing below root
// mounts, so the app's boot signal — which lives in a provider inside a layout
// route — never fires and the app-owned splash never self-unmounts. Native/
// installed only in the wild; on web the critical-CSS policy renders the leftover
// `display: none`.
//
// These build the shape the playground has (providers layout → pages) and assert
// on `[data-adaptv-splash]`, the attribute the real overlay carries.

const NOT_FOUND_TEXT = "no such route"
const HOME_TEXT = "home page"

//the shell also mounts the rotate guard, which fetches the manifest. There is no
//server here, so answer it with an unlocked manifest — otherwise every test in
//this file spews a connection-refused rejection that has nothing to do with it.
beforeEach(() => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(new Response("{}", { status: 200 })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function buildApp({ readyOnMount }: { readyOnMount: boolean }) {
  //the app's ready gate: module-level, flipped by a provider in a layout route
  const gate = createBootstrapGate()
  const stats = {
    splashMounts: 0,
    //every value of `revealedAt` the splash was rendered with, in order
    revealedAt: [] as Array<number | null>,
  }

  function TestSplash({ revealedAt }: SplashScreenProps) {
    const ready = gate.useBootstrapReady()
    stats.revealedAt.push(revealedAt)
    useEffect(() => {
      stats.splashMounts += 1
    }, [])
    if (ready) return null
    return <PwaSplashOverlay>booting</PwaSplashOverlay>
  }

  const rootRoute = createRootRoute({
    title: "test",
    themeColorLight: "#ffffff",
    themeColorDark: "#000000",
    splashScreenComponent: TestSplash,
    splashScreenInBrowser: true,
    //the built-in document renders <html>/<head>, which cannot mount into a
    //Testing Library container. The shell under test is RoutingShell, and a
    //custom document is a supported config.
    RootDocument: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
    notFoundComponent: () => <p>{NOT_FOUND_TEXT}</p>,
  })

  //pathless layout holding the app's boot work, exactly like the playground's
  //providers layout — the route a not-found boundary at root skips.
  const providersLayout = createRoute({
    getParentRoute: () => rootRoute,
    id: "providers",
    component: function ProvidersLayout() {
      //(`readyOnMount` is fixed per built app, so this runs once on mount)
      useEffect(() => {
        if (readyOnMount) gate.setBootstrapReady()
      }, [readyOnMount])
      return <Outlet />
    },
  })

  const indexRoute = createRoute({
    getParentRoute: () => providersLayout,
    path: "/",
    component: () => <p>{HOME_TEXT}</p>,
  })

  return {
    gate,
    stats,
    routeTree: rootRoute.addChildren([
      providersLayout.addChildren([indexRoute]),
    ]),
  }
}

function renderAt(
  initialPath: string,
  { readyOnMount = true }: { readyOnMount?: boolean } = {},
) {
  const { gate, stats, routeTree } = buildApp({ readyOnMount })
  const router = createAdaptvRouter({
    routeTree,
    options: {
      history: createMemoryHistory({ initialEntries: [initialPath] }),
    },
  })
  const view = render(<RouterProvider router={router} />)
  return { ...view, router, gate, stats }
}

function splash(container: HTMLElement) {
  return container.querySelector("[data-adaptv-splash]")
}

describe("RoutingShell — splash vs the not-found boundary", () => {
  it("mounts the splash on a real route and lets it self-unmount", async () => {
    //boot signal held, so the splash is observable while the app "boots"
    const { container, findByText, gate, stats } = renderAt("/", {
      readyOnMount: false,
    })

    await findByText(HOME_TEXT)
    expect(splash(container)).not.toBeNull()
    expect(stats.splashMounts).toBe(1)

    act(() => gate.setBootstrapReady())
    expect(splash(container)).toBeNull()
  })

  //A splash is mounted UNDER the OS launch splash, so mount time is not view time.
  //Handing it `revealedAt` is what lets a "stay up for at least a second" rule mean a
  //second the user saw — before this, that second was spent behind the OS splash and
  //the brand flashed for whatever was left.
  it("tells the splash when it went on screen, not when it mounted", async () => {
    const { findByText, stats } = renderAt("/", { readyOnMount: false })

    await findByText(HOME_TEXT)
    //the handoff has not happened on the first render, and saying it had would be
    //the bug: it is a promise chain behind a painted frame
    expect(stats.revealedAt[0]).toBeNull()

    await waitFor(() =>
      expect(stats.revealedAt.at(-1)).toEqual(expect.any(Number)),
    )
  })

  it("never leaves the splash up on a cold start into a 404", async () => {
    const { container, findByText, stats } = renderAt(
      "/definitely-not-a-route",
    )

    await findByText(NOT_FOUND_TEXT)
    //nothing on this path can flip the app's gate — the providers layout is not
    //in the match chain — so the shell has to retire the splash itself, and it
    //must never have painted, not even for a frame
    expect(splash(container)).toBeNull()
    expect(stats.splashMounts).toBe(0)
    await waitFor(() => expect(splash(container)).toBeNull())
  })

  it("does not replay the splash when navigating out of a 404", async () => {
    const { container, findByText, router, stats } = renderAt(
      "/definitely-not-a-route",
    )

    await findByText(NOT_FOUND_TEXT)
    await act(() => router.navigate({ to: "/" }))

    await findByText(HOME_TEXT)
    //retiring is one-way: a fresh mount here would hand the splash a ready gate
    //it has to dismiss off, flashing full-screen over an already-booted app
    expect(stats.splashMounts).toBe(0)
    expect(splash(container)).toBeNull()
  })
})

// A deploy prunes the hashed chunks an open tab still points at, so its next lazy
// route import 404s and Vite dispatches `vite:preloadError`. The shell answers with
// ONE reload, stamped in sessionStorage, and only renders the offline screen when
// that reload happened moments ago and did not help.
//
// It used to arm the net twice — once from the service-worker runtime, once from
// the shell — and the two shared a single guard. The first handler reloaded and
// spent it; the second, handed the same event, found it spent and rendered the
// offline screen on top of the reload it had just watched start. The user saw
// "You're offline" for the reload's whole round trip on every stale-chunk
// recovery that WORKED. `e2e-sw/stale-chunk.spec.ts` measures it in a browser.
describe("RoutingShell — the stale-chunk net", () => {
  const GUARD_KEY = "adaptv:preload-error-reload"

  let reloads = 0

  beforeEach(() => {
    reloads = 0
    sessionStorage.clear()
    vi.spyOn(window.location, "reload").mockImplementation(() => {
      reloads += 1
    })
    //"this document already asked for a reload" lives in module scope, because it
    //must die with the document. Each test here is a fresh document.
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    sessionStorage.clear()
  })

  async function mountShell() {
    const {
      createMemoryHistory,
      createRoute: freshCreateRoute,
      RouterProvider,
    } = await import("@tanstack/react-router")
    const { createRootRoute: freshCreateRootRoute } = await import(
      "#adaptv/shell/create-root-route"
    )
    const { createAdaptvRouter: freshCreateAdaptvRouter } = await import(
      "#adaptv/shell/create-adaptv-router"
    )
    const rootRoute = freshCreateRootRoute({
      title: "test",
      themeColorLight: "#ffffff",
      themeColorDark: "#000000",
      RootDocument: ({ children }: { children: ReactNode }) => (
        <>{children}</>
      ),
    })
    const indexRoute = freshCreateRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => <p>{HOME_TEXT}</p>,
    })
    const router = freshCreateAdaptvRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      options: { history: createMemoryHistory({ initialEntries: ["/"] }) },
    })
    const view = render(<RouterProvider router={router} />)
    await view.findByText(HOME_TEXT)
    return view
  }

  //Vite's own shape: cancelable, and it rethrows unless a listener prevents it
  function dispatchStaleChunk() {
    const event = new Event("vite:preloadError", { cancelable: true })
    act(() => {
      window.dispatchEvent(event)
    })
    return event
  }

  function offlineScreen(container: HTMLElement) {
    return container.querySelector('[data-adaptv="offline"]')
  }

  it("reloads on the first stale chunk, and shows no offline screen", async () => {
    const { container } = await mountShell()

    const event = dispatchStaleChunk()

    //Left for Vite to rethrow, so the import keeps its real error. The router
    //holds a missing-module import as a reload in progress and draws nothing;
    //prevented, the import resolves to `undefined` instead, and the app's error
    //boundary is drawn over the reload — measured in a browser, where it simply
    //replaced the offline screen as the thing on top of the recovery.
    expect(event.defaultPrevented).toBe(false)
    //the reload is the recovery; an offline screen here is painted over a reload
    //that is already on its way to fixing the page
    expect({ reloads, offline: !!offlineScreen(container) }).toEqual({
      reloads: 1,
      offline: false,
    })
  })

  it("stays quiet for every further failure in the document that is reloading", async () => {
    //Several lazy imports in flight when the deploy lands each fail, and each
    //dispatches its own event. Only the first is news.
    const { container } = await mountShell()

    dispatchStaleChunk()
    const later = dispatchStaleChunk()
    dispatchStaleChunk()

    expect(later.defaultPrevented).toBe(false)
    expect({ reloads, offline: !!offlineScreen(container) }).toEqual({
      reloads: 1,
      offline: false,
    })
  })

  it("shows the offline screen, and does not reload again, when a reload moments ago failed to help", async () => {
    //the previous document stamped its reload a second ago; this one booted and
    //hit the same missing chunk, so it is genuinely gone and reloading would loop
    sessionStorage.setItem(GUARD_KEY, String(Date.now() - 1_000))
    const { container } = await mountShell()

    const event = dispatchStaleChunk()

    await waitFor(() => expect(offlineScreen(container)).not.toBeNull())
    expect(reloads).toBe(0)
    //the shell owns this failure now, so Vite must not also rethrow it
    expect(event.defaultPrevented).toBe(true)
  })

  it("reloads, and shows no offline screen, in a tab whose last recovery was long ago", async () => {
    //a tab that recovered from one deploy and stayed open meets the next one: that
    //is a new stale chunk, not the last reload failing
    sessionStorage.setItem(GUARD_KEY, String(Date.now() - 10 * 60_000))
    const { container } = await mountShell()

    const event = dispatchStaleChunk()

    expect(event.defaultPrevented).toBe(false)
    expect({ reloads, offline: !!offlineScreen(container) }).toEqual({
      reloads: 1,
      offline: false,
    })
  })
})

//every app mounts this shell, so one API it reaches for that an old engine lacks
//takes the whole app down on that engine, not just one screen
describe("RoutingShell on an engine without Array.prototype.at (iOS 15.0–15.3)", () => {
  let at: PropertyDescriptor | undefined

  beforeEach(() => {
    at = Object.getOwnPropertyDescriptor(Array.prototype, "at")
    Reflect.deleteProperty(Array.prototype, "at")
  })

  afterEach(() => {
    if (at) Object.defineProperty(Array.prototype, "at", at)
  })

  it("renders the route on screen", async () => {
    expect(Array.prototype.at).toBeUndefined()
    const { findByText } = renderAt("/")
    expect(await findByText(HOME_TEXT)).toBeTruthy()
  })
})
