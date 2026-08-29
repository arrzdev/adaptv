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
