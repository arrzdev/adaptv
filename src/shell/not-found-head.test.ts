import {
  createMemoryHistory,
  createRoute,
  notFound,
} from "@tanstack/react-router"
import { describe, expect, it } from "vitest"
import { createAdaptvRouter } from "#adaptv/shell/create-adaptv-router"
import { createRootRoute } from "#adaptv/shell/create-root-route"

//A URL that names nothing used to get the app's own title and description: a search
//engine that crawled it saw a copy of the home page under another address.
async function headAt(path: string) {
  const rootRoute = createRootRoute({
    title: "Probe: the long home title",
    description: "What the app is.",
    openGraph: { image: "/og.png" },
    twitter: {},
    meta: [{ name: "google-site-verification", content: "token" }],
    themeColorLight: "#ffffff",
    themeColorDark: "#000000",
    notFoundTitle: "Page not found · Probe",
  })
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
  })
  const docRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/docs/$slug",
    loader: ({ params }) => {
      if (params.slug !== "real") throw notFound()
    },
  })
  const router = createAdaptvRouter({
    routeTree: rootRoute.addChildren([indexRoute, docRoute]),
    options: { history: createMemoryHistory({ initialEntries: [path] }) },
  })
  await router.load()
  const meta = router.state.matches.flatMap((match) => match.meta ?? [])
  const byName = (name: string) =>
    meta.find((tag) => tag && "name" in tag && tag.name === name)
  return {
    title: meta.find((tag) => tag && "title" in tag)?.title,
    description: byName("description"),
    robots: byName("robots"),
    social: meta.filter(
      (tag) =>
        tag &&
        (("property" in tag && String(tag.property).startsWith("og:")) ||
          ("name" in tag && String(tag.name).startsWith("twitter:"))),
    ),
    verification: byName("google-site-verification"),
  }
}

describe("the root head on the not-found screen", () => {
  for (const path of ["/nope", "/docs/nope"]) {
    it(`${path} has its own title, no summary and noindex`, async () => {
      const head = await headAt(path)
      expect(head.title).toBe("Page not found · Probe")
      expect(head.description).toBeUndefined()
      expect(head.social).toEqual([])
      expect(head.robots).toEqual({ name: "robots", content: "noindex" })
      //the app's own extra tags stay: a site verification is for every URL
      expect(head.verification).toBeDefined()
    })
  }

  it("a page that exists keeps the app's head and is indexable", async () => {
    for (const path of ["/", "/docs/real"]) {
      const head = await headAt(path)
      expect(head.title).toBe("Probe: the long home title")
      expect(head.description).toEqual({
        name: "description",
        content: "What the app is.",
      })
      expect(head.social).not.toEqual([])
      expect(head.robots).toBeUndefined()
    }
  })
})
