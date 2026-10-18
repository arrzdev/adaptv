import { expect, type Page, test } from "@playwright/test"

//UI quality gate, phones: every header control and every code-block Copy button has a hit
//area of at least 44x44 CSS px, the header stays on one row, and the keyboard focus ring of
//the primary call to action is visible (3:1 against the page) in both themes (TUD-1625).
const MIN = 44

async function sizes(tab: Page, selector: string) {
  return tab.locator(selector).evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect()
      return {
        name: node.getAttribute("aria-label") ?? node.textContent?.trim() ?? "",
        width: Math.round(box.width * 10) / 10,
        height: Math.round(box.height * 10) / 10,
        top: box.top,
        bottom: box.bottom,
        right: box.right,
      }
    }),
  )
}

for (const width of [375, 320]) {
  test.describe(`phone ${width}px`, () => {
    test.use({ viewport: { width, height: 740 } })

    test("header controls are 44x44 and the header is one row", async ({ page }) => {
      await page.goto("/")
      await page.waitForLoadState("networkidle")
      const controls = await sizes(page, "header a, header button")
      console.log(`header ${width}px`, JSON.stringify(controls.map((c) => `${c.name} ${c.width}x${c.height}`)))
      expect(controls.map((c) => c.name)).toEqual(
        expect.arrayContaining(["adaptv", "Docs", "Blog", "adaptv on GitHub", "Toggle light and dark"]),
      )
      for (const control of controls) {
        expect(control.width, `${control.name} width`).toBeGreaterThanOrEqual(MIN)
        expect(control.height, `${control.name} height`).toBeGreaterThanOrEqual(MIN)
      }
      //one row: the controls share a vertical band and none leaves the viewport
      expect(Math.max(...controls.map((c) => c.top)) - Math.min(...controls.map((c) => c.top))).toBeLessThan(MIN / 2)
      expect(Math.max(...controls.map((c) => c.right))).toBeLessThanOrEqual(width)
      const { scrollWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth }))
      expect(scrollWidth, "horizontal scroll").toBeLessThanOrEqual(width)
    })

    test("code-block Copy buttons are 44x44", async ({ page }) => {
      await page.goto("/docs/quick-start")
      await page.waitForLoadState("networkidle")
      const buttons = await sizes(page, 'button[aria-label="Copy"]')
      console.log(`copy ${width}px`, JSON.stringify(buttons.map((c) => `${c.width}x${c.height}`)))
      expect(buttons.length).toBeGreaterThan(0)
      for (const button of buttons) {
        expect(button.width, "Copy width").toBeGreaterThanOrEqual(MIN)
        expect(button.height, "Copy height").toBeGreaterThanOrEqual(MIN)
      }
    })
  })
}

for (const scheme of ["light", "dark"] as const) {
  test(`Get started focus ring has 3:1 contrast on the ${scheme} page`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto("/")
    await page.waitForLoadState("networkidle")
    const cta = page.getByRole("link", { name: "Get started" }).first()
    await cta.focus()
    await page.keyboard.press("Shift+Tab")
    await page.keyboard.press("Tab")
    await expect(cta).toBeFocused()
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement
      const style = getComputedStyle(el)
      const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
      if (!canvas) throw new Error("no canvas")
      const rgb = (colour: string) => {
        canvas.clearRect(0, 0, 1, 1)
        canvas.fillStyle = "#000"
        canvas.fillStyle = colour
        canvas.fillRect(0, 0, 1, 1)
        return Array.from(canvas.getImageData(0, 0, 1, 1).data.slice(0, 3))
      }
      return {
        html: document.documentElement.className,
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth),
        ring: rgb(style.outlineColor),
        page: rgb(getComputedStyle(document.body).backgroundColor),
      }
    })
    const luminance = (c: number[]) => {
      const [r, g, b] = c.map((v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const [hi, lo] = [luminance(ring.ring), luminance(ring.page)].sort((a, b) => b - a)
    const contrast = (hi + 0.05) / (lo + 0.05)
    console.log(`ring ${scheme}`, JSON.stringify(ring), contrast.toFixed(2))
    expect(ring.style).not.toBe("none")
    expect(ring.width).toBeGreaterThanOrEqual(2)
    expect(contrast).toBeGreaterThanOrEqual(3)
  })
}
