import { readdirSync, readFileSync } from "node:fs"
import { expect, type Page, test } from "@playwright/test"

//The pages a stranger reaches on publish day. `/docs/button` is a docs page with a live
//demo; the post is one of the entries in `src/content/blog.ts`.
const PAGES = [
  { name: "landing", path: "/" },
  { name: "docs home", path: "/docs" },
  { name: "docs page with a live demo", path: "/docs/button" },
  { name: "blog index", path: "/blog" },
  { name: "blog post", path: "/blog/ios-ghost-caret" },
]

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
]

//Every docs page and blog post, read from the sources and not imported: the docs index
//pulls in the live demos, which Playwright's loader cannot compile. The sitemap test below
//proves this list matches the one the build ships (TUD-953).
const CONTENT = new URL("../src/content/", import.meta.url)
const DOC_SLUGS = readdirSync(new URL("docs/pages/", CONTENT))
  .filter((file) => file.endsWith(".ts"))
  .map((file) => {
    const source = readFileSync(new URL(`docs/pages/${file}`, CONTENT), "utf8")
    const slug = source.match(/^ {2}slug: "([^"]+)"/m)?.[1]
    if (!slug) throw new Error(`no slug in docs/pages/${file}`)
    return slug
  })
const POST_SLUGS = [
  ...readFileSync(new URL("blog.ts", CONTENT), "utf8").matchAll(/^ {4}slug: "([^"]+)"/gm),
].map((match) => match[1])
const EVERY_PAGE = [
  ...DOC_SLUGS.map((slug) => `/docs/${slug}`),
  ...POST_SLUGS.map((slug) => `/blog/${slug}`),
].sort()

/** Loads `path` and asserts its status, an `h1`, no horizontal scroll and no errors. */
async function loadsClean(tab: Page, path: string) {
  const problems: string[] = []
  tab.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`)
  })
  tab.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`))

  const response = await tab.goto(path)
  expect(response?.status()).toBe(200)
  await expect(tab.locator("h1").first()).toBeVisible()
  //hydration and lazy chunks settle before the verdict on errors and overflow
  await tab.waitForLoadState("networkidle")

  const { scrollWidth, innerWidth } = await tab.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(scrollWidth, "horizontal scroll").toBeLessThanOrEqual(innerWidth)
  expect(problems).toEqual([])
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } })

    for (const page of PAGES) {
      test(`${page.name} (${page.path}) loads clean`, async ({ page: tab }) => {
        await loadsClean(tab, page.path)
      })
    }

    //A stale or mistyped link: under a section and at the top level. Every page is
    //prerendered, so the Worker has no page for these and once answered a raw JSON 500
    //(TUD-945). The answer is a 404 status with a page a reader can navigate away from.
    for (const path of ["/docs/nope", "/nope"]) {
      test(`unknown url (${path}) is a 404 page with the site header`, async ({ page: tab }) => {
        const problems: string[] = []
        tab.on("console", (message) => {
          if (message.type() !== "error") return
          //the browser logs the document's own 404 status; that one is the point
          if (message.location().url === tab.url() && message.text().includes("404")) return
          problems.push(`console: ${message.text()}`)
        })
        tab.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`))

        const response = await tab.goto(path)
        expect(response?.status()).toBe(404)
        await expect(tab.locator("h1").first()).toBeVisible()
        await expect(tab.locator("header").getByRole("link", { name: "adaptv on GitHub" })).toBeVisible()
        await tab.waitForLoadState("networkidle")

        const { scrollWidth, innerWidth } = await tab.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }))
        expect(scrollWidth, "horizontal scroll").toBeLessThanOrEqual(innerWidth)
        expect(problems).toEqual([])
      })
    }
  })
}

//A docs table, a code block or a long word overflows on a phone first; the desktop
//layout has room. Every page at the phone width, so one that scrolls sideways fails the PR.
test.describe("every docs page and blog post, phone 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("the list is the sitemap's", async ({ request }) => {
    const sitemap = await (await request.get("/sitemap.xml")).text()
    const shipped = [...sitemap.matchAll(/<loc>[^<]*?(\/(?:docs|blog)\/[^<]+)<\/loc>/g)]
      .map((match) => match[1])
      .sort()
    expect(EVERY_PAGE).toEqual(shipped)
  })

  for (const path of EVERY_PAGE) {
    test(`${path} loads clean`, async ({ page: tab }) => {
      await loadsClean(tab, path)
    })
  }
})

//A block that scrolls sideways must be reachable and named without a mouse. Chrome makes a
//scroller focusable itself; Safari does not, and axe `scrollable-region-focusable` flagged it
//on 60 pages (TUD-2115). A scroller with a focusable child (the sample tabs) is exempt, as in
//axe. Measured at the phone width, where the blocks overflow.
test.describe("scrollable regions are keyboard-reachable and named, phone 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const path of ["/", ...EVERY_PAGE]) {
    test(`${path} @webkit`, async ({ page: tab }) => {
      await tab.goto(path)
      await tab.waitForLoadState("networkidle")
      const bad = await tab.evaluate(() => {
        const FOCUSABLE = "a[href],button,input,select,textarea,[tabindex]:not([tabindex='-1'])"
        const out: string[] = []
        for (const el of document.querySelectorAll<HTMLElement>("body *")) {
          const style = getComputedStyle(el)
          const scrolls = ["auto", "scroll"].includes(style.overflowX) && el.scrollWidth > el.clientWidth + 1
          const scrollsY = ["auto", "scroll"].includes(style.overflowY) && el.scrollHeight > el.clientHeight + 1
          if (!scrolls && !scrollsY) continue
          if (el.querySelector(FOCUSABLE)) continue
          const ok =
            el.getAttribute("tabindex") === "0" &&
            el.getAttribute("role") === "region" &&
            (el.getAttribute("aria-label") ?? "").trim() !== ""
          if (!ok) out.push(`${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80))
        }
        return out
      })
      expect(bad, "scrollers without tabindex=0, role=region and an aria-label").toEqual([])
    })
  }
})
