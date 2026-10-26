import { cleanup, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { PROBLEMS, Problems } from "@/components/sections/problems"
import { POSTS } from "@/content/blog"

//the real link needs a router; resolve the one route the section uses by hand
vi.mock("adaptv/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("adaptv/components")>()),
  Link: ({
    to,
    params,
    children,
  }: {
    to: string
    params: { slug: string }
    children: ReactNode
  }) => <a href={to.replace("$slug", params.slug)}>{children}</a>,
}))

afterEach(cleanup)

describe("problem links", () => {
  // the home page is the strongest URL: it links the three problem-first posts so a
  // crawler reaches them without running any script
  it("links the three problem-first posts", () => {
    const { container } = render(<Problems />)
    const hrefs = [...container.querySelectorAll("a")].map((a) =>
      a.getAttribute("href"),
    )
    expect(hrefs).toEqual([
      "/blog/ios-safari-input-zoom-on-focus",
      "/blog/ios-pwa-safe-area-insets-zero",
      "/blog/disable-pull-to-refresh-overscroll-behavior",
    ])
  })

  // the link text is the problem: the post's search title, so a renamed or removed post
  // fails here rather than leaving a dead link on the home page
  it("names each post by its search title", () => {
    for (const problem of PROBLEMS) {
      const post = POSTS.find((p) => p.slug === problem.slug)
      expect(post, problem.slug).toBeDefined()
      expect(problem.title).toBe(post?.seoTitle)
    }
  })
})
