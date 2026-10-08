import { afterEach, describe, expect, it, vi } from "vitest"
import { lazyRouteComponent } from "#adaptv/routes/lazy-route-component.ts"

/*
 * A split route whose chunk is gone reloads the page once. React renders the suspended
 * route more than once before the page goes, and with react-router 1.170.19's
 * `lazyRouteComponent` the second render threw the import error, so the app's error
 * screen drew over the reload. The end-to-end proof is `e2e-sw/stale-chunk.spec.ts`.
 */

const MISSING = new TypeError(
  "Failed to fetch dynamically imported module: /assets/home-old.js",
)

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

function stubReload() {
  const reload = vi.fn()
  vi.spyOn(window, "location", "get").mockReturnValue({
    ...window.location,
    reload,
  })
  return reload
}

describe("lazyRouteComponent", () => {
  it("suspends every render after a missing chunk, until the reload lands", async () => {
    const reload = stubReload()
    const Lazy = lazyRouteComponent(() => Promise.reject(MISSING))
    await Lazy.preload()

    for (let render = 0; render < 3; render++) {
      let thrown: unknown
      try {
        Lazy({})
      } catch (value) {
        thrown = value
      }
      expect(thrown).toBeInstanceOf(Promise)
    }
    expect(reload).toHaveBeenCalled()
    expect(
      sessionStorage.getItem(`tanstack_router_reload:${MISSING.message}`),
    ).toBe("1")
  })

  it("throws the error when the reload already happened once for that chunk", async () => {
    const reload = stubReload()
    sessionStorage.setItem(
      `tanstack_router_reload:${MISSING.message}`,
      "1",
    )
    const Lazy = lazyRouteComponent(() => Promise.reject(MISSING))
    await Lazy.preload()

    expect(() => Lazy({})).toThrow(MISSING)
    expect(reload).not.toHaveBeenCalled()
  })

  it("throws any other import error without reloading", async () => {
    const reload = stubReload()
    const failure = new Error("boom")
    const Lazy = lazyRouteComponent(() => Promise.reject(failure))
    await Lazy.preload()

    expect(() => Lazy({})).toThrow(failure)
    expect(reload).not.toHaveBeenCalled()
  })

  it("renders the named export once the chunk has loaded", async () => {
    const Page = () => null
    const Lazy = lazyRouteComponent(
      () => Promise.resolve({ Page }),
      "Page",
    )
    await Lazy.preload()

    expect(Lazy({})).toMatchObject({ type: Page })
  })
})
