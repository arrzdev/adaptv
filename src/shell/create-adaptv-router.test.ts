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
})
