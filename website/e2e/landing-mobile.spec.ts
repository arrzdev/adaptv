import { expect, type Page, test } from "@playwright/test"

//The landing on phones (audit `landing-mobile-audit`, TUD-3785): the hero footnote reaches
//4.5:1 against the aurora painted behind it, not only against the page colour, and the
//time wheel in "Try the components here" is reached through its columns, never its rows.
//Tagged @webkit: the aurora is a blurred gradient each engine paints its own way.

const MIN_CONTRAST = 4.5
const MIN_TARGET = 44
const FOOTNOTE = "Open source, MIT. Pre-alpha, so expect rough edges."

const VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 402, height: 710 },
  { width: 1280, height: 800 },
]

async function open(page: Page, theme: "light" | "dark") {
  await page.addInitScript((value) => {
    localStorage.setItem("ui-theme-preference", value)
  }, theme)
  await page.goto("/")
  await page.waitForLoadState("networkidle")
  await page.evaluate(() => document.fonts.ready)
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(
    theme === "dark",
  )
}

/**
 * The lowest contrast of the footnote's text colour against any pixel of the backdrop under
 * it. The text is made transparent for the shot, so only the aurora and the page are read.
 */
async function footnoteContrast(page: Page) {
  const note = page.getByText(FOOTNOTE, { exact: true })
  //its rise-in fades the opacity: measure the settled state
  await note.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
  const color = await note.evaluate((el) => getComputedStyle(el).color)
  await note.evaluate((el) => el.style.setProperty("color", "transparent"))
  const shot = (await note.screenshot({ animations: "disabled" })).toString("base64")
  await note.evaluate((el) => el.style.removeProperty("color"))
  return page.evaluate(
    async ({ png, text }) => {
      const canvas = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
      if (!canvas) throw new Error("no canvas")
      const rgb = (css: string) => {
        canvas.canvas.width = canvas.canvas.height = 1
        canvas.fillStyle = "#000"
        canvas.fillStyle = css
        canvas.fillRect(0, 0, 1, 1)
        return Array.from(canvas.getImageData(0, 0, 1, 1).data.slice(0, 3))
      }
      const channel = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      const luminance = (c: number[]) =>
        0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])
      const fg = luminance(rgb(text))
      const image = new Image()
      image.src = `data:image/png;base64,${png}`
      await image.decode()
      canvas.canvas.width = image.width
      canvas.canvas.height = image.height
      canvas.drawImage(image, 0, 0)
      const data = canvas.getImageData(0, 0, image.width, image.height).data
      let worst = Number.POSITIVE_INFINITY
      for (let i = 0; i < data.length; i += 4) {
        const bg = luminance([data[i], data[i + 1], data[i + 2]])
        const [hi, lo] = [fg, bg].sort((a, b) => b - a)
        worst = Math.min(worst, (hi + 0.05) / (lo + 0.05))
      }
      return worst
    },
    { png: shot, text: color },
  )
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of VIEWPORTS) {
    test(`hero footnote reaches ${MIN_CONTRAST}:1 on the aurora, ${theme}, ${viewport.width}x${viewport.height} @webkit`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await open(page, theme)
      const ratio = await footnoteContrast(page)
      console.log(`footnote ${theme} ${viewport.width}px ${ratio.toFixed(2)}:1`)
      expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST)
    })
  }
}

for (const viewport of VIEWPORTS) {
  test(`time wheel: each column is a ${MIN_TARGET} px target and the one stop, ${viewport.width}px @webkit`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await open(page, "light")
    for (const name of ["Hour", "Minute"]) {
      const column = page.getByRole("group", { name, exact: true })
      await column.scrollIntoViewIfNeeded()
      const box = await column.boundingBox()
      expect(box?.width, `${name} width`).toBeGreaterThanOrEqual(MIN_TARGET)
      expect(box?.height, `${name} height`).toBeGreaterThanOrEqual(MIN_TARGET)
      expect(await column.getAttribute("tabindex")).toBe("0")
      //the rows are a tap convenience under the column's own gesture, never a stop of their own
      const rows = await column.locator("button").evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).tabIndex),
      )
      expect(rows.length).toBeGreaterThan(0)
      expect(new Set(rows)).toEqual(new Set([-1]))
    }
  })
}
