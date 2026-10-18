import { readdirSync, readFileSync } from "node:fs"
import { expect, type Page, test } from "@playwright/test"

//The legibility floor of the site (TUD-1626): no visible text under 12 px, platform pills
//and code comments at 4.5:1 or better, long inline code wrapping inside its paragraph.
//Pages are read from the sources like smoke.spec.ts does.
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
const PAGES = [
  "/",
  "/docs",
  "/blog",
  ...DOC_SLUGS.map((slug) => `/docs/${slug}`),
  ...POST_SLUGS.map((slug) => `/blog/${slug}`),
]

const MIN_FONT_PX = 12
const MIN_CONTRAST = 4.5

type Theme = "light" | "dark"

async function open(tab: Page, path: string, theme: Theme) {
  await tab.addInitScript((value) => {
    localStorage.setItem("ui-theme-preference", value)
  }, theme)
  await tab.goto(path)
  await expect(tab.locator("h1").first()).toBeVisible()
  await tab.waitForLoadState("networkidle")
  expect(await tab.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(
    theme === "dark",
  )
}

/** Visible text elements (own text node, non-empty) under the font floor. */
async function smallText(tab: Page): Promise<string[]> {
  return tab.evaluate((floor) => {
    const found = new Set<string>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      const el = node.parentElement
      if (!el || el.closest("script,style,noscript,[aria-hidden='true']")) continue
      const box = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      if (!box.width || !box.height || style.visibility === "hidden") continue
      const size = Number.parseFloat(style.fontSize)
      if (size < floor) {
        found.add(`${size}px "${node.textContent.trim().slice(0, 30)}" <${el.tagName.toLowerCase()}>`)
      }
    }
    return [...found]
  }, MIN_FONT_PX)
}

/** Contrast of each matched element's text colour on its first opaque ancestor background. */
async function contrasts(tab: Page, selector: string): Promise<string[]> {
  return tab.evaluate(
    ({ selector: query, min }) => {
      const probe = document.createElement("canvas").getContext("2d")
      if (!probe) throw new Error("no canvas")
      const rgba = (css: string): [number, number, number, number] => {
        probe.clearRect(0, 0, 1, 1)
        probe.fillStyle = "#000"
        probe.fillStyle = css
        probe.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data
        return [r, g, b, a / 255]
      }
      const channel = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      const luminance = (c: number[]) =>
        0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])
      const over = (top: number[], bottom: number[]) => {
        const a = top[3]
        return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a))
      }
      const backdrop = (el: Element): number[] => {
        const layers: number[][] = []
        for (let at: Element | null = el; at; at = at.parentElement) {
          const bg = rgba(getComputedStyle(at).backgroundColor)
          if (bg[3] > 0) layers.push(bg)
          if (bg[3] === 1) break
        }
        let result = [255, 255, 255, 1]
        for (const layer of layers.reverse()) result = [...over(layer, result), 1]
        return result
      }
      const failures: string[] = []
      for (const el of document.querySelectorAll(query)) {
        if (!el.getBoundingClientRect().width) continue
        const bg = backdrop(el)
        const fg = rgba(getComputedStyle(el).color)
        const text = [...over(fg, bg), 1]
        const [light, dark] = [luminance(text), luminance(bg)].sort((a, b) => b - a)
        const ratio = (light + 0.05) / (dark + 0.05)
        if (ratio < min) {
          failures.push(`${ratio.toFixed(2)}:1 "${(el.textContent ?? "").trim().slice(0, 24)}"`)
        }
      }
      return [...new Set(failures)]
    },
    { selector, min: MIN_CONTRAST },
  )
}

for (const width of [375, 1280]) {
  test.describe(`text floor at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })
    for (const path of PAGES) {
      test(`${path} has no text under ${MIN_FONT_PX}px`, async ({ page }) => {
        await open(page, path, "light")
        expect(await smallText(page)).toEqual([])
      })
    }
  })
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`contrast in the ${theme} theme`, () => {
    test.use({ viewport: { width: 1280, height: 900 } })
    for (const path of ["/docs/button", "/docs/the-frame", "/docs/drawer", "/blog/ios-ghost-caret"]) {
      test(`${path}: platform pills and code comments reach ${MIN_CONTRAST}:1`, async ({ page }) => {
        await open(page, path, theme)
        expect(await contrasts(page, "[data-platform], .tok-c")).toEqual([])
      })
    }
  })
}

//the pills only show on pages that declare platforms, so make sure the check above looks at some
test("the reference pages carry platform pills the contrast check can see", async ({ page }) => {
  await open(page, "/docs/button", "light")
  expect(await page.locator("[data-platform]").count()).toBeGreaterThan(0)
})

for (const width of [320, 375]) {
  test(`long inline code wraps inside its paragraph at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await open(page, "/docs/the-frame", "light")
    const overflowing = await page.evaluate(() => {
      const limit = document.documentElement.clientWidth
      return [...document.querySelectorAll("p code, li code")]
        .filter((el) => el.getBoundingClientRect().right > limit + 0.5)
        .map((el) => (el.textContent ?? "").slice(0, 60))
    })
    expect(overflowing).toEqual([])
  })
}
