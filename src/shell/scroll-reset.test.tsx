import {
  createMemoryHistory,
  createRoute,
  RouterProvider,
} from "@tanstack/react-router"
import { act, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Link } from "#adaptv/components/link"
import { ScrollView } from "#adaptv/components/scroll-view"
import { createAdaptvRouter } from "#adaptv/shell/create-adaptv-router"
import { createRootRoute } from "#adaptv/shell/create-root-route"

//The document never scrolls in an adaptv app; a page scrolls inside its ScrollView.
//The route engine resets only `window` on a navigation, so a link to another page left
//the page scroller where it was and the next page opened mid-way down: on the website,
//from one blog post or docs page to the next (same route, so the same element). These
//run the real shell, so the scroller sits in the real screen frame.

//the shell mounts the rotate guard, which fetches the manifest; there is no server
beforeEach(() => {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(new Response("{}", { status: 200 })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function Page({ children }: { children: ReactNode }) {
  return (
    <ScrollView>
      {/* a nested scroller, like the website's sticky docs nav */}
      <ScrollView data-testid="side-nav">
        <p>nav</p>
      </ScrollView>
      {children}
    </ScrollView>
  )
}

function renderApp(options: Record<string, unknown> = {}) {
  const rootRoute = createRootRoute({
    title: "test",
    themeColorLight: "#ffffff",
    themeColorDark: "#000000",
    //the built-in document renders <html>/<head>, which cannot mount into a
    //Testing Library container
    RootDocument: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
  })
  const postRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/posts/$slug",
    component: function Post() {
      const { slug } = postRoute.useParams()
      return (
        <Page>
          <h1>post {slug}</h1>
          <Link
            to="/posts/$slug"
            params={{ slug: "kept" }}
            resetScroll={false}
          >
            keep my place
          </Link>
          <h2 id="part-two">part two</h2>
        </Page>
      )
    },
  })
  const otherRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/other",
    component: () => (
      <Page>
        <h1>other</h1>
      </Page>
    ),
  })
  const router = createAdaptvRouter({
    routeTree: rootRoute.addChildren([postRoute, otherRoute]),
    options: {
      history: createMemoryHistory({ initialEntries: ["/posts/a"] }),
      ...options,
    },
  })
  const view = render(<RouterProvider router={router} />)
  return { ...view, router }
}

//the page's own scroller: the outer ScrollView in the screen frame
function pageScroller(container: HTMLElement) {
  const element = container.querySelector<HTMLElement>(
    '[data-adaptv-screen] [data-scroll-view="y"]',
  )
  if (!element) throw new Error("no page scroller")
  return element
}

//what a reader's scroll does: move the scroller and fire `scroll`, which is what the
//engine listens to before it records a position
function scrollTo(element: HTMLElement, top: number) {
  element.scrollTop = top
  element.dispatchEvent(new Event("scroll"))
}

async function heading(
  findByRole: ReturnType<typeof render>["findByRole"],
  name: string,
) {
  await findByRole("heading", { level: 1, name })
  //the reset runs once the new page has rendered
  await act(async () => {})
}

describe("scroll on navigation", () => {
  it("a navigation to another page of the same route starts at the top", async () => {
    const { container, findByRole, router } = renderApp()
    await heading(findByRole, "post a")
    scrollTo(pageScroller(container), 600)

    await act(() =>
      router.navigate({ to: "/posts/$slug", params: { slug: "b" } }),
    )
    await heading(findByRole, "post b")

    expect(pageScroller(container).scrollTop).toBe(0)
  })

  it("a navigation leaves a scroller nested in the page where it was", async () => {
    const { container, findByRole, getByTestId, router } = renderApp()
    await heading(findByRole, "post a")
    scrollTo(pageScroller(container), 600)
    scrollTo(getByTestId("side-nav"), 80)

    await act(() =>
      router.navigate({ to: "/posts/$slug", params: { slug: "b" } }),
    )
    await heading(findByRole, "post b")

    expect(pageScroller(container).scrollTop).toBe(0)
    expect(getByTestId("side-nav").scrollTop).toBe(80)
  })

  it("back brings back where the reader was on the previous page", async () => {
    const { container, findByRole, router } = renderApp()
    await heading(findByRole, "post a")
    scrollTo(pageScroller(container), 600)

    await act(() => router.navigate({ to: "/other" }))
    await heading(findByRole, "other")
    expect(pageScroller(container).scrollTop).toBe(0)
    scrollTo(pageScroller(container), 200)

    act(() => router.history.back())
    await heading(findByRole, "post a")
    expect(pageScroller(container).scrollTop).toBe(600)

    act(() => router.history.forward())
    await heading(findByRole, "other")
    expect(pageScroller(container).scrollTop).toBe(200)
  })

  it("a link with resetScroll={false} keeps the position", async () => {
    const { container, findByRole, getByText } = renderApp()
    await heading(findByRole, "post a")
    scrollTo(pageScroller(container), 600)

    act(() => getByText("keep my place").click())
    await heading(findByRole, "post kept")

    expect(pageScroller(container).scrollTop).toBe(600)
  })

  it("a navigation with a hash scrolls to its anchor instead of the top", async () => {
    const { container, findByRole, router } = renderApp()
    await heading(findByRole, "post a")
    scrollTo(pageScroller(container), 600)
    const scrolledIntoView: string[] = []
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(
      function (this: Element) {
        scrolledIntoView.push(this.id)
      },
    )

    await act(() =>
      router.navigate({
        to: "/posts/$slug",
        params: { slug: "b" },
        hash: "part-two",
      }),
    )
    await heading(findByRole, "post b")

    expect(scrolledIntoView).toEqual(["part-two"])
    expect(pageScroller(container).scrollTop).toBe(600)
  })

  it("router config can turn the reset off", async () => {
    const { container, findByRole, router } = renderApp({
      scrollToTopSelectors: [],
    })
    await heading(findByRole, "post a")
    scrollTo(pageScroller(container), 600)

    await act(() =>
      router.navigate({ to: "/posts/$slug", params: { slug: "b" } }),
    )
    await heading(findByRole, "post b")

    expect(pageScroller(container).scrollTop).toBe(600)
  })
})
