import {
  createLazyRoute,
  createMemoryHistory,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createAdaptvRouter } from "#adaptv/shell/create-adaptv-router"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("createAdaptvRouter", () => {
  //A link preloads its route on intent (hover, touchstart), and the tap that follows
  //navigates while that preload is still in flight. The navigation's commit clears
  //the expired cache, which drops the cached match of a route with no loader, so the
  //preload came back to a match that was gone and threw `match._nonReactive` (the
  //route engine caught it and console.error'd it). Seen ~1 in 8 on webkit in
  //playground/e2e/icon.spec.ts, the StrictMode client-navigation test.
  it("a navigation that commits during a preload leaves the preload to finish quietly", async () => {
    let release = () => {}
    const chunk = new Promise<void>((resolve) => {
      release = resolve
    })
    const rootRoute = createRootRoute()
    const routeTree = rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: "/" }),
      //code-split like every app route, and no loader: its cached match is the one
      //a commit evicts while the chunk is still loading
      createRoute({
        getParentRoute: () => rootRoute,
        path: "/preloaded",
      }).lazy(() => chunk.then(() => createLazyRoute("/preloaded")({}))),
      createRoute({ getParentRoute: () => rootRoute, path: "/elsewhere" }),
    ])
    const router = createAdaptvRouter({
      routeTree,
      options: { history: createMemoryHistory({ initialEntries: ["/"] }) },
    })
    await router.load()
    const error = vi.spyOn(console, "error").mockImplementation(() => {})

    const preload = router.preloadRoute({ to: "/preloaded" })
    await router.navigate({ to: "/elsewhere" })
    release()
    await preload

    expect(router.state.location.pathname).toBe("/elsewhere")
    expect(error).not.toHaveBeenCalled()
  })

  //adaptv has no document scroll: a page scrolls in its root ScrollView, the only
  //child of the screen frame. The router's default reset target is `window` alone,
  //which never moves, so a scroller that survived a navigation kept its offset.
  //playground/e2e/scroll-reset.spec.ts drives it in a browser.
  describe("scroll to top on navigation", () => {
    const routeTree = createRootRoute().addChildren([])

    it("resets the page scroller as well as the window", () => {
      const router = createAdaptvRouter({ routeTree })
      expect(router.options.scrollToTopSelectors).toEqual([
        "window",
        "[data-adaptv-screen] > [data-scroll-view]",
      ])
    })

    it("adds an app's own targets after the page scroller", () => {
      const pane = () => null
      const router = createAdaptvRouter({
        routeTree,
        options: { scrollToTopSelectors: ["#side", pane] },
      })
      expect(router.options.scrollToTopSelectors).toEqual([
        "window",
        "[data-adaptv-screen] > [data-scroll-view]",
        "#side",
        pane,
      ])
    })
  })
})
