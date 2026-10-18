import { expect, type Locator, type Page, test } from "@playwright/test"

//The landing after landing-v4 (doc `landing-v4`): the hero shows "Tally", one budget app drawn
//in HTML/CSS as a desktop browser window and as a phone, with the platform marks strip under
//it on the hero's glow; then come the components grid, "The hard parts are already decided", "Four ways to ship one app" and
//the closing quick start. Sections are centred heads over large flat cards.
//Layout is read from the rendered boxes, not from class names.

const SHOWCASE_LABEL =
  "Tally, a budget app, in a desktop browser window and on a phone: the same app with a sidebar on desktop and a tab bar on the phone."

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await page.goto("/")
  await page.evaluate(() => document.fonts.ready)
}

function showcase(page: Page) {
  return page.getByRole("img", { name: SHOWCASE_LABEL, exact: true })
}

/** The box of an element, plus the viewport width, in CSS px. */
function box(locator: Locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return {
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      //the layout size, before any transform: the desktop window is laid out at desktop width
      layoutWidth: (el as HTMLElement).offsetWidth,
      innerWidth: window.innerWidth,
    }
  })
}

test.describe("Tally showcase", () => {
  for (const width of [390, 1440]) {
    test(`desktop window and phone are both visible at ${width} px @webkit`, async ({
      page,
    }) => {
      await open(page, width)
      const stage = showcase(page)
      await expect(stage).toBeVisible()
      const hero = page.locator("section:has(h1)").first()
      await expect(hero.getByRole("img", { name: SHOWCASE_LABEL })).toHaveCount(1)

      const desktop = stage.getByTestId("tally-desktop")
      const phone = stage.getByTestId("tally-phone")
      const parts = {
        sidebar: stage.getByTestId("tally-sidebar"),
        tabbar: stage.getByTestId("tally-tabbar"),
        "large title": stage.getByTestId("tally-large-title"),
      }
      const heroBox = await box(hero)
      for (const [name, part] of Object.entries(parts)) {
        await expect(part, name).toHaveCount(1)
        const b = await box(part)
        expect.soft(b.width, `${name} has a size`).toBeGreaterThan(0)
        expect.soft(b.height, `${name} has a size`).toBeGreaterThan(0)
        expect.soft(b.left, `${name} starts inside the viewport`).toBeGreaterThanOrEqual(0)
        expect.soft(b.right, `${name} ends inside the viewport`).toBeLessThanOrEqual(b.innerWidth)
        //the hero clips its overflow; a part below its bottom edge is cut off
        expect.soft(b.bottom, `${name} is not cut by the hero`).toBeLessThanOrEqual(heroBox.bottom)
      }
      await expect(parts["large title"]).toHaveText("October")

      const d = await box(desktop)
      const p = await box(phone)
      const s = await box(stage)
      //the desktop window keeps its desktop layout at every width: the sidebar is a fifth of it
      const side = await box(parts.sidebar)
      expect.soft(side.width / d.width, "sidebar a fifth of the window").toBeGreaterThanOrEqual(0.18)
      expect.soft(side.width / d.width, "sidebar a fifth of the window").toBeLessThanOrEqual(0.22)
      expect.soft(d.right, "desktop window inside the viewport").toBeLessThanOrEqual(d.innerWidth)
      expect.soft(d.left, "desktop window inside the viewport").toBeGreaterThanOrEqual(0)
      expect.soft(p.right, "phone inside the viewport").toBeLessThanOrEqual(p.innerWidth)
      //the phone stands level with the window: centred on its height, never hanging below it
      expect
        .soft(Math.abs((p.top + p.bottom) / 2 - (d.top + d.bottom) / 2), "phone level with the window")
        .toBeLessThanOrEqual(2)
      //the phone overlaps the window's right edge
      expect.soft(p.left, "phone overlaps the window").toBeLessThan(d.right)
      expect.soft(p.top, "phone overlaps the window").toBeLessThan(d.bottom)
      expect.soft(p.right, "phone sits at the right").toBeGreaterThan(d.right - p.width)
      if (width >= 768) {
        expect.soft(d.width, "window about 1000 px wide").toBeGreaterThanOrEqual(940)
        expect.soft(d.height, "window about 560 px tall").toBeGreaterThanOrEqual(500)
        expect.soft(d.height, "window about 560 px tall").toBeLessThanOrEqual(620)
        expect.soft(p.width, "phone about 260 px wide").toBeGreaterThanOrEqual(230)
        expect.soft(p.width, "phone about 260 px wide").toBeLessThanOrEqual(290)
      } else {
        //landing-v4 §2.1: the window takes the full content width, the phone is about a
        //quarter of it and covers only the window's right edge
        expect.soft(d.width, "window fills the stage").toBeGreaterThanOrEqual(s.width - 1)
        //the hero, not the viewport: a desktop browser's scrollbar takes 15 px of the 390
        expect
          .soft(d.width, "window wider than the page column")
          .toBeGreaterThanOrEqual(heroBox.width - 32)
        expect.soft(p.width / s.width, "phone about a quarter of the width").toBeGreaterThanOrEqual(0.22)
        expect.soft(p.width / s.width, "phone about a quarter of the width").toBeLessThanOrEqual(0.3)
      }
      //the phone screen is not empty: its large title is drawn inside the phone, at its scale
      //the text's own box: the span is stretched to the screen's width
      const title = await parts["large title"].evaluate((el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return range.getBoundingClientRect()
      })
      expect.soft(title.left, "title inside the phone").toBeGreaterThanOrEqual(p.left)
      expect.soft(title.right, "title inside the phone").toBeLessThanOrEqual(p.right)
      expect.soft(title.top, "title inside the phone").toBeGreaterThanOrEqual(p.top)
      expect.soft(title.bottom, "title inside the phone").toBeLessThanOrEqual(p.bottom)
      expect.soft(title.width / p.width, "title at the phone's scale").toBeGreaterThan(0.2)
      expect.soft(title.width / p.width, "title at the phone's scale").toBeLessThan(0.6)

      const scroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(scroll.scrollWidth, "horizontal scroll").toBeLessThanOrEqual(scroll.innerWidth)
    })
  }

  //TUD-866 (design sign-off TUD-836): from 768 px the phone sits beside the window, not over
  //its table. The Amount column and the green income row (landing-v2 §2.4) stay in sight.
  for (const width of [768, 1024, 1440, 1920]) {
    test(`the phone leaves the Amount column and the income row visible at ${width} px @webkit`, async ({
      page,
    }) => {
      await open(page, width)
      const stage = showcase(page)
      await expect(stage).toBeVisible()
      const desktop = stage.getByTestId("tally-desktop")
      const p = await box(stage.getByTestId("tally-phone"))
      const amounts = desktop.locator("table tr > :nth-child(4)")
      const income = desktop.locator("table tr", { hasText: "+$3,150.00" })
      //the header and the five transactions
      await expect(amounts).toHaveCount(6)
      await expect(income).toHaveCount(1)

      const covered = (b: Awaited<ReturnType<typeof box>>) =>
        b.left < p.right && b.right > p.left && b.top < p.bottom && b.bottom > p.top
      for (const [i, cell] of (await amounts.all()).entries()) {
        const b = await box(cell)
        const label = `Amount cell ${i} (${await cell.innerText()}) is under the phone`
        expect.soft(covered(b), label).toBe(false)
      }
      expect.soft(covered(await box(income)), "the income row is under the phone").toBe(false)

      const scroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(scroll.scrollWidth, "horizontal scroll").toBeLessThanOrEqual(scroll.innerWidth)
    })
  }

  test("is drawn in HTML and CSS: no image, canvas or video inside", async ({ page }) => {
    await open(page, 1440)
    const stage = showcase(page)
    await expect(stage).toBeVisible()
    await expect(stage.locator("img, picture, canvas, video, iframe, svg image")).toHaveCount(0)
    const backgrounds = await stage.evaluate((root) =>
      [root, ...root.querySelectorAll("*")]
        .map((el) => getComputedStyle(el).backgroundImage)
        .filter((image) => image.includes("url(")),
    )
    expect(backgrounds, "no background-image url()").toEqual([])
    //the inner content is decoration for assistive tech: the label says it all
    await expect(stage.locator(":scope > *").first()).toHaveAttribute("aria-hidden", "true")
  })

  //landing-v4 §2.1: on an iPhone the window drew unscaled and the phone blank. Both views were
  //laid out at a fixed size and shrunk by a computed `scale: tan(atan2(...))`; a browser that
  //drops that declaration draws them at full size. Now they are drawn in container units, so
  //no element of the showcase is scaled at all
  for (const width of [390, 1440]) {
    test(`nothing in the showcase is scaled at ${width} px @webkit`, async ({ page }) => {
      await open(page, width)
      const stage = showcase(page)
      await expect(stage).toBeVisible()
      const scaled = await stage.evaluate((root) =>
        [root, ...root.querySelectorAll("*")]
          .map((el) => {
            const cs = getComputedStyle(el)
            const name = `${el.tagName.toLowerCase()}.${String(el.getAttribute("class")).slice(0, 40)}`
            return { name, scale: cs.scale, zoom: cs.zoom }
          })
          .filter((e) => !["none", "1"].includes(e.scale) || !["1", "normal"].includes(e.zoom)),
      )
      expect(scaled).toEqual([])
    })
  }

  test("one data set feeds both views", async ({ page }) => {
    await open(page, 1440)
    const stage = showcase(page)
    const desktop = (await stage.getByTestId("tally-desktop").textContent()) ?? ""
    const phone = (await stage.getByTestId("tally-phone").textContent()) ?? ""

    for (const text of ["October", "$716", "$1,284", "$2,000"]) {
      expect.soft(desktop, `desktop shows ${text}`).toContain(text)
      expect.soft(phone, `phone shows ${text}`).toContain(text)
    }
    for (const text of [
      "Tally",
      "Overview",
      "Transactions",
      "Budgets",
      "Accounts",
      "Settings",
      "$3,150",
      "Daily spending",
      "$312 of $400",
      "$156 of $300",
      "$62 of $200",
      "$48 of $60",
      "Whole Foods",
      "Uber",
      "Salary",
      "Netflix",
      "Blue Bottle",
      "−$42.18",
      "+$3,150.00",
    ]) {
      expect.soft(desktop, `desktop shows ${text}`).toContain(text)
    }
    for (const text of [
      "9:41",
      "$1,284 of $2,000 spent",
      "Groceries",
      "Eating out",
      "Transport",
      "Whole Foods",
      "Uber",
      "Salary",
      "Overview",
      "Transactions",
      "Budgets",
      "Settings",
    ]) {
      expect.soft(phone, `phone shows ${text}`).toContain(text)
    }
    //14 days, Oct 1–14, as divs; the chart is not a library
    await expect(stage.getByTestId("tally-chart").getByTestId("tally-bar")).toHaveCount(14)
  })

  test("is static: clicking or dragging changes nothing", async ({ page }) => {
    await open(page, 1440)
    const stage = showcase(page)
    await expect(stage).toBeVisible()
    expect(await stage.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none")
    await expect(
      stage.locator("a, button, input, select, textarea, [tabindex], [contenteditable]"),
    ).toHaveCount(0)

    const before = await stage.evaluate((el) => el.innerHTML)
    const b = await box(stage)
    const x = b.left + b.width / 2
    const y = Math.min(b.top + b.height / 2, 850)
    await page.mouse.click(x, y)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 200, y, { steps: 10 })
    await page.mouse.up()
    expect(await stage.evaluate((el) => el.innerHTML)).toBe(before)
  })

  test("the hero does not shift after the first paint", async ({ page }) => {
    await open(page, 1440)
    await expect(showcase(page)).toBeVisible()
    const cls = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const hero = document.querySelector("section:has(h1)")
          let sum = 0
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as (PerformanceEntry & {
              value: number
              sources?: { node?: Node | null }[]
            })[]) {
              if (entry.sources?.some((s) => s.node && hero?.contains(s.node)))
                sum += entry.value
            }
          }).observe({ type: "layout-shift", buffered: true })
          setTimeout(() => resolve(sum), 1500)
        }),
    )
    expect(cls).toBe(0)
  })

  //The CLS above is 0 only when Geist arrives before the first paint. This one does not race
  //the network: the hero is laid out once in the fallback font (Geist blocked) and once in
  //Geist, and the showcase must sit at the same place in both (TUD-861: the intro wrapped to
  //3 lines in the fallback and 4 in Geist, and the swap pushed the showcase down 31 px).
  //The showcase slides up 24 px as it enters (`stage-in`, done 540 ms after the first style):
  //its box is read once that has finished, or the two loads compare two points of the slide
  //and not two layouts. When Geist arrived inside those 540 ms the Geist reading sat 8 px
  //lower than the fallback one at 640 px, with the same layout in both fonts.
  async function restingBox(locator: Locator) {
    await locator.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    return box(locator)
  }

  for (const width of [640, 768, 1024, 1440]) {
    test(`the web font swap moves nothing in the hero at ${width} px`, async ({
      page,
    }) => {
      //two full page loads: on a loaded VM each one has taken 12-15 s
      test.setTimeout(60_000)
      await open(page, width)
      const geist = await restingBox(showcase(page))
      //the intro's box is as tall as its lines in Geist: a copy edit that wraps it to 3 or 5
      //lines must change its reserved height too
      const intro = page.getByText(/^adaptv is a React framework/)
      const fit = await intro.evaluate((el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
        const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight)
        return { text: lines.size * lineHeight, box: el.getBoundingClientRect().height }
      })
      expect(Math.abs(fit.text - fit.box)).toBeLessThan(1)
      //the site's own font files (`src/assets/fonts/`, fingerprinted into `/assets/`)
      await page.route(/\/assets\/geist[^/]*\.woff2$/, (route) => route.abort())
      await open(page, width)
      //no Geist face loaded: the faces are declared, but their files never arrived
      expect(
        await page.evaluate(() =>
          [...document.fonts].some((f) => f.family.includes("Geist") && f.status === "loaded"),
        ),
      ).toBe(false)
      const fallback = await restingBox(showcase(page))
      expect(fallback.top).toBe(geist.top)
    })
  }

  //The title's two lines are centred. Centred text starts at half its width, and the fallback
  //sets a line a few px wider or narrower than Geist (6 px at the start of line 2 at 390 px,
  //hinting makes it vary by size), so the swap moved the text: a 0.00046 layout shift of the
  //`<h1>` whenever Geist landed after the first paint, about 1 load in 4. Each line is a box
  //as wide as Geist sets it, text from its left edge, so the text starts at the same x in
  //any font.
  /** Where each title line starts, and how far its text is from filling the line's box. */
  function titleLines(page: Page) {
    return page.locator("h1").evaluate((h1) =>
      [...h1.childNodes]
        .filter((line) => line.textContent?.trim())
        .map((line) => {
          const range = document.createRange()
          range.selectNodeContents(line)
          const text = range.getBoundingClientRect()
          //a bare text node has no box of its own
          const box = line instanceof Element ? line.getBoundingClientRect() : { width: 0 }
          return { start: text.left, gap: Math.abs(box.width - text.width) }
        }),
    )
  }

  for (const width of [320, 390, 768, 1440]) {
    test(`the web font swap moves no line of the title at ${width} px`, async ({ page }) => {
      test.setTimeout(60_000)
      await open(page, width)
      await page.locator("h1").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
      const geist = await titleLines(page)
      expect(geist).toHaveLength(2)
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
      await open(page, width)
      await page.locator("h1").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
      const fallback = await titleLines(page)
      expect(fallback.map((l) => l.start)).toEqual(geist.map((l) => l.start))
      //each box is as wide as its line in Geist: a copy edit must change the box too
      for (const line of geist) expect(line.gap).toBeLessThan(1)
    })
  }
})

const HERO_TITLE = "Write React once Feel native everywhere."
const HARD_TITLE = "The hard parts are already decided"
const COMPARE_TITLE = "Four ways to ship one app"

test.describe("section order", () => {
  test("hero, components, the hard parts, four ways, quick start", async ({
    page,
  }) => {
    await open(page, 1440)
    const headings = await page
      .locator(":is(h1, h2):not(header *, footer *)")
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, " ").trim()),
      )
    //the strip has no heading: it sits in the hero, under the showcase
    expect(headings).toEqual([
      HERO_TITLE,
      "Try the components here",
      HARD_TITLE,
      COMPARE_TITLE,
      "Start with the quick start",
    ])
    for (const gone of [
      "Where it runs",
      "From idea to installed app",
      "Built with adaptv",
      "Why adaptv",
      "How it compares",
      "One React app. At home on every screen.",
    ])
      await expect.soft(page.getByText(gone), `"${gone}" is gone`).toHaveCount(0)
  })

  for (const width of [320, 390, 768, 1440]) {
    test(`no horizontal scroll at ${width} px`, async ({ page }) => {
      await open(page, width)
      await expect(page.getByRole("heading", { name: COMPARE_TITLE })).toBeAttached()
      const scroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }))
      expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.innerWidth)
    })
  }
})

function section(page: Page, title: string) {
  return page.locator("section").filter({
    has: page.getByRole("heading", { level: 2, name: title, exact: true }),
  })
}

/** Distinct rounded tops of a set of elements: one per visual row. */
function rows(locator: Locator) {
  return locator.evaluateAll((els) => [
    ...new Set(els.map((el) => Math.round(el.getBoundingClientRect().top))),
  ])
}

/** The platform marks strip: the line "One app. Every platform." and the marks under it. */
function strip(page: Page) {
  return page.getByText("One app. Every platform.", { exact: true }).locator("xpath=..")
}

//The strip is `targets.tsx` from before #444 (64bbb23^), minus the Windows and macOS marks
//(#448: desktop native is not built). It sits in the hero, under the showcase, on the orange
//foot of the glow behind it; it had its own section under the hero before.
test.describe("platform strip", () => {
  test("the strip sits in the hero under the showcase, with no section of its own", async ({
    page,
  }) => {
    await open(page, 1440)
    const hero = page.locator("section:has(h1)")
    await expect(hero.getByText("One app. Every platform.", { exact: true })).toHaveCount(1)
    const [s, show] = await Promise.all([box(strip(page)), box(showcase(page))])
    expect(s.top).toBeGreaterThan(show.bottom)
    //the section after the hero opens with a heading: no headless strip section between
    await expect(
      page.locator("section:has(h1) + section").getByRole("heading", { level: 2 }).first(),
    ).toHaveText("Try the components here")
  })

  //The glow behind the showcase was cut by the hero's clip: a straight line of colour across
  //the page under the showcase. It now fades out above the hero's bottom edge, so the hero's
  //last row is the page's background, the colour of the plain space under it.
  for (const colorScheme of ["light", "dark"] as const) {
    test(`the glow under the strip fades out before the hero ends, ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme })
      await page.addInitScript(
        (t) => localStorage.setItem("ui-theme-preference", t),
        colorScheme,
      )
      await open(page, 1440)
      const hero = page.locator("section:has(h1)")
      const bottom = Math.round((await box(hero)).bottom)
      //everything down to the hero's edge in view: the site scrolls inside its app container
      await page.setViewportSize({ width: 1440, height: bottom + 40 })
      await hero.evaluate((el) =>
        Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
      )
      const row = async (y: number) => {
        const png = await page.screenshot({ clip: { x: 0, y, width: 1440, height: 1 } })
        return page.evaluate(async (b64) => {
          const img = new Image()
          img.src = `data:image/png;base64,${b64}`
          await img.decode()
          const c = new OffscreenCanvas(img.width, img.height)
          const ctx = c.getContext("2d")!
          ctx.drawImage(img, 0, 0)
          return [...ctx.getImageData(0, 0, img.width, 1).data]
        }, png.toString("base64"))
      }
      const edge = await row(bottom - 1)
      const below = await row(bottom + 20)
      let worst = 0
      for (let i = 0; i < edge.length; i++) worst = Math.max(worst, Math.abs(edge[i] - below[i]))
      expect(worst, "largest channel difference across the hero's edge").toBeLessThanOrEqual(2)
    })
  }

  test("four marks, no heading, no cards", async ({ page }) => {
    await open(page, 1440)
    const s = strip(page)
    await expect(s).toHaveCount(1)
    await expect(s.getByRole("heading")).toHaveCount(0)
    await expect(s).toContainText("One app. Every platform.")
    const marks = s.getByRole("listitem")
    //each mark is a drawing that carries its name as hidden text
    await expect(marks).toHaveText(["iOS", "Android", "PWA", "Capacitor"])
    await expect(s.locator("li svg")).toHaveCount(4)
    await expect(s).not.toContainText("Windows")
    await expect(s).not.toContainText("macOS")
  })

  for (const width of [320, 390, 1440]) {
    test(`the marks sit in one centred row with one gap at ${width} px`, async ({ page }) => {
      await open(page, width)
      const s = strip(page)
      const marks = s.getByRole("listitem")
      await expect(marks).toHaveCount(4)
      //a 3-column grid leaves Capacitor alone on a second row (TUD-836)
      expect(await rows(marks), "one row").toHaveLength(1)
      const [b, items] = await Promise.all([
        box(s),
        marks.evaluateAll((els) => els.map((el) => el.getBoundingClientRect())),
      ])
      const left = items[0].left - b.left
      const right = b.right - items.at(-1)!.right
      expect(Math.abs(left - right), "centred in the strip").toBeLessThanOrEqual(1)
      const gaps = new Set<number>()
      for (let i = 1; i < items.length; i++)
        gaps.add(Math.round(items[i].left - items[i - 1].right))
      expect([...gaps], "one gap between marks").toHaveLength(1)
    })
  }
})

/** A section head as landing-v4 draws it: centred, no eyebrow above the title. */
async function expectCentredHead(sec: Locator, title: string) {
  const h2 = sec.getByRole("heading", { level: 2, name: title, exact: true })
  await expect(h2).toBeVisible()
  const [h, s] = await Promise.all([box(h2), box(sec)])
  const centre = (h.left + h.right) / 2
  expect.soft(Math.abs(centre - (s.left + s.right) / 2), `${title}: centred`).toBeLessThanOrEqual(2)
  expect.soft(await h2.evaluate((el) => getComputedStyle(el).textAlign), `${title}: text centred`).toBe("center")
  //no eyebrow: nothing in the section is drawn above the title
  const above = await sec.evaluate((root, top) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const hits: string[] = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.trim()
      if (!text) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      const r = range.getBoundingClientRect()
      if (r.height > 0 && r.bottom <= top) hits.push(text)
    }
    return hits
  }, h.top)
  expect.soft(above, `${title}: no eyebrow`).toEqual([])
}

/** The cards of a section: the `data-card` boxes. */
function cards(sec: Locator) {
  return sec.locator("[data-card]")
}

/** A card's look: background, border, shadow, radius. */
function look(locator: Locator) {
  return locator.evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el)
      return {
        background: cs.backgroundColor,
        shadow: cs.boxShadow,
        radius: cs.borderTopLeftRadius,
        border: cs.borderTopColor,
      }
    }),
  )
}

test.describe("card system", () => {
  for (const width of [390, 1440]) {
    test(`flat cards, 24 / 40 px radius, no shadow, no hairline between sections at ${width} px`, async ({
      page,
    }) => {
      await open(page, width)
      //the components grid keeps v3's cards on the dotted canvas (board): a centred head only
      await expectCentredHead(section(page, "Try the components here"), "Try the components here")
      for (const title of [HARD_TITLE, COMPARE_TITLE]) {
        const sec = section(page, title)
        await expectCentredHead(sec, title)
        const looks = await look(cards(sec))
        expect(looks.length, `${title}: has cards`).toBeGreaterThan(0)
        for (const l of looks) {
          expect.soft(l.radius, `${title}: card radius`).toBe(width >= 768 ? "40px" : "24px")
          expect.soft(l.shadow, `${title}: no shadow`).toBe("none")
          expect.soft(l.border, `${title}: border transparent`).toBe("rgba(0, 0, 0, 0)")
        }
        expect.soft(new Set(looks.map((l) => l.background)).size, `${title}: one card colour`).toBe(1)
        const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
        expect.soft(looks[0].background, `${title}: one shade off the page`).not.toBe(pageBg)
        expect
          .soft(await sec.evaluate((el) => getComputedStyle(el).borderTopWidth), `${title}: no hairline`)
          .toBe("0px")
      }
    })
  }
})

const HARD_LEDE =
  "Gestures, scroll, the keyboard and safe areas behave the way each phone expects. You write the app."

const HARD_CARDS = [
  [
    "One React app on every screen",
    "The same code deploys to the web, installs from the browser, and builds for iOS and Android.",
  ],
  [
    "One gesture at a time",
    "One controller decides who owns each touch: the sheet, the back swipe or pull-to-refresh.",
  ],
  [
    "The keyboard never hides the field",
    "The page stays put, and the sheet rises with the keyboard instead.",
  ],
  [
    "Edge to edge, inside the safe areas",
    "The framework owns the insets and the scroll, so content never slides under the notch or drags the page.",
  ],
  [
    "Mistakes stop at build time",
    "Code that cannot run inside an app fails the build, not your users.",
  ],
] as const

test.describe("The hard parts are already decided", () => {
  test("lede, five cards in order, each a title, a body and one diagram", async ({ page }) => {
    await open(page, 1440)
    const hard = section(page, HARD_TITLE)
    await expect(hard).toHaveCount(1)
    await expect(hard).toContainText(HARD_LEDE)
    const list = cards(hard)
    await expect(list).toHaveCount(5)
    await expect(list.getByRole("heading", { level: 3 })).toHaveText(HARD_CARDS.map(([t]) => t))
    for (const [i, [, body]] of HARD_CARDS.entries()) {
      const card = list.nth(i)
      await expect.soft(card, `card ${i}`).toContainText(body)
      //the diagram is decoration: the card's text carries the meaning
      const svg = card.locator("svg[viewBox]")
      await expect.soft(svg.first(), `card ${i}: diagram hidden from assistive tech`).toHaveAttribute("aria-hidden", "true")
      expect.soft(await card.locator("img, picture, canvas, video, iframe").count(), `card ${i}: no raster`).toBe(0)
    }
    await expect(list.first().getByRole("link", { name: /See the targets/ })).toHaveAttribute(
      "href",
      "/docs/six-targets",
    )
    //the claim on card E is the build's own message
    await expect(list.nth(4)).toContainText("adaptv apps have no server side")
  })

  for (const width of [390, 1440]) {
    test(`the first card spans the grid, the rest pair up at ${width} px`, async ({ page }) => {
      await open(page, width)
      const list = cards(section(page, HARD_TITLE))
      await expect(list).toHaveCount(5)
      const boxes = await list.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect()
          return { left: r.left, top: Math.round(r.top), width: r.width, height: r.height }
        }),
      )
      const [a, ...rest] = boxes
      if (width >= 768) {
        for (const b of rest)
          expect.soft(a.width, "card A is two cards wide").toBeGreaterThan(b.width * 1.8)
        expect.soft(new Set(rest.map((b) => b.top)).size, "two rows of two").toBe(2)
      } else {
        expect.soft(new Set(boxes.map((b) => b.top)).size, "one column").toBe(5)
        for (const b of rest) expect.soft(Math.abs(b.width - a.width), "same width").toBeLessThanOrEqual(1)
      }
      for (const b of boxes) expect.soft(b.left + b.width, "inside the viewport").toBeLessThanOrEqual(width)
    })
  }
})

//landing-v4 §2.5, the rows from docs/research/landscape.md §1 (each one sourced there)
const COMPARE = [
  ["adaptv", "React, HTML and CSS", "The browser's DOM; a WebView in the apps", "The primary target"],
  ["Ionic + Capacitor", "Angular, React or Vue", "Web Components in a WebView", "A web app"],
  ["React Native + Expo", "React", "Real native views", "Through react-native-web"],
  ["Flutter", "Dart", "Its own engine, every pixel", "Supported; not for text-heavy sites"],
] as const
const COMPARE_ROWS = ["You write", "What draws the UI", "The web"]

test.describe("Four ways to ship one app", () => {
  test("lede, four columns of three labelled rows, the footnote", async ({ page }) => {
    await open(page, 1440)
    const compare = section(page, COMPARE_TITLE)
    await expect(compare).toHaveCount(1)
    await expect(compare).toContainText("Each tool draws the line in a different place. Here is where.")
    const columns = compare.getByRole("listitem")
    await expect(columns).toHaveCount(4)
    await expect(columns.getByRole("heading", { level: 3 })).toHaveText(COMPARE.map(([name]) => name))
    for (const [i, [name, ...values]] of COMPARE.entries()) {
      const col = columns.nth(i)
      await expect.soft(col.locator("dt"), `${name}: labels`).toHaveText(COMPARE_ROWS)
      await expect.soft(col.locator("dd"), `${name}: rows`).toHaveText([...values])
      for (const v of values) expect.soft(v.split(/\s+/).length, `${name}: "${v}" ≤ 8 words`).toBeLessThanOrEqual(8)
    }
    await expect(compare).toContainText("adaptv is pre-alpha and not yet on npm.")
    await expect(compare).not.toContainText(/[✓✔✗✘]/)
    await expect(compare).not.toContainText(/\b(recommended|best|winner|can't|cannot)\b/i)
    await expect(compare).not.toContainText("Draft copy")
  })

  for (const width of [390, 1440]) {
    test(`four equal columns, one look, at ${width} px`, async ({ page }) => {
      await open(page, width)
      const columns = section(page, COMPARE_TITLE).getByRole("listitem")
      await expect(columns).toHaveCount(4)
      await columns.first().scrollIntoViewIfNeeded()
      const sizes = await columns.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          return {
            width: r.width,
            height: r.height,
            look: [cs.backgroundColor, cs.borderTopColor, cs.borderTopWidth, cs.boxShadow].join(" | "),
          }
        }),
      )
      for (const s of sizes.slice(1)) {
        expect.soft(Math.abs(s.width - sizes[0].width), "same width").toBeLessThanOrEqual(1)
        expect.soft(s.look, "same look as adaptv's column").toBe(sizes[0].look)
      }
      if (width >= 768) {
        for (const s of sizes.slice(1))
          expect.soft(Math.abs(s.height - sizes[0].height), "same height").toBeLessThanOrEqual(1)
        expect(await rows(columns)).toHaveLength(1)
      } else expect(await rows(columns)).toHaveLength(4)
    })
  }
})

test.describe("closing", () => {
  //the board kept v3's closing: the soft brand gradient under the title, copy unchanged
  test("the brand gradient under the title, copy unchanged", async ({ page }) => {
    await open(page, 1440)
    const close = section(page, "Start with the quick start")
    await expect(close).toContainText(
      "Clone the repository and run the playground on a simulator or your phone.",
    )
    await expect(close.locator(".aurora")).toHaveCount(1)
    await expect(close.locator("[data-icon-tile]")).toHaveCount(0)
  })
})

//landing-v3 "Zero layout shift": every layout-shift entry from the first paint through a
//scroll to the bottom and back, at a phone and a desktop width. Reveals move by transform,
//which is not a layout shift; a box that grows, a late font or an image without size is.
/** Down in viewport-sized steps, so every reveal and lazy part runs, then back up. */
async function scrollThrough(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y <= height; y += 450) {
    await page.evaluate((top) => window.scrollTo(0, top), y)
    await page.waitForTimeout(150)
  }
  await page.waitForTimeout(1500)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(500)
}

/** Every revealed block that is not drawn in its final state: faded, moved or blurred. */
function unrevealed(page: Page) {
  return page.locator("[data-reveal]").evaluateAll((els) =>
    els
      .map((el) => {
        const cs = getComputedStyle(el)
        return {
          text: (el.textContent ?? "").trim().slice(0, 40),
          opacity: cs.opacity,
          transform: cs.transform,
          filter: cs.filter,
        }
      })
      .filter((e) => e.opacity !== "1" || e.transform !== "none" || e.filter !== "none"),
  )
}

//landing-v4 §3: under reduced motion every reveal is drawn in its final state and nothing runs
test.describe("reduced motion", () => {
  for (const width of [390, 1440]) {
    test(`no animation runs and every block is in place at ${width} px`, async ({ page }) => {
      test.setTimeout(60_000)
      await page.emulateMedia({ reducedMotion: "reduce" })
      await open(page, width)
      await expect(page.locator("[data-reveal]").first()).toBeAttached()
      await scrollThrough(page)
      const running = await page.evaluate(() =>
        document.getAnimations().map((a) => {
          const target = (a.effect as KeyframeEffect | null)?.target as Element | null
          return `${a.constructor.name} on ${target?.tagName.toLowerCase()}.${String(target?.getAttribute("class")).slice(0, 40)}`
        }),
      )
      expect(running).toEqual([])
      expect(await unrevealed(page)).toEqual([])
    })
  }
})

//landing-v4 §3 rule 5: a reveal ships hidden in the HTML; without JS it must not stay hidden
test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })
  test("every section is visible", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    await page.goto("/")
    await expect(page.locator("[data-reveal]").first()).toBeAttached()
    expect(await unrevealed(page)).toEqual([])
    for (const title of ["Try the components here", HARD_TITLE, COMPARE_TITLE, "Start with the quick start"])
      await expect.soft(page.getByRole("heading", { level: 2, name: title })).toBeVisible()
  })
})

test.describe("zero layout shift", () => {
  for (const [width, colorScheme] of [
    [390, "light"],
    [390, "dark"],
    [1440, "light"],
    [1440, "dark"],
  ] as const) {
    test(`CLS is 0 over a full scroll at ${width} px, ${colorScheme}`, async ({ page }) => {
      test.setTimeout(60_000)
      await page.emulateMedia({ colorScheme })
      await page.addInitScript(() => {
        const w = window as unknown as { shifts: { value: number; nodes: string[] }[] }
        w.shifts = []
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & {
            value: number
            hadRecentInput: boolean
            sources?: { node?: Node | null }[]
          })[]) {
            if (entry.hadRecentInput) continue
            w.shifts.push({
              value: entry.value,
              nodes: (entry.sources ?? []).map((s) => {
                const el = s.node as Element | null
                if (!el?.tagName) return String(s.node?.nodeName)
                return `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`
              }),
            })
          }
        }).observe({ type: "layout-shift", buffered: true })
      })
      await open(page, width)
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${colorScheme}\\b`))
      await scrollThrough(page)
      const shifts = await page.evaluate(
        () => (window as unknown as { shifts: { value: number; nodes: string[] }[] }).shifts,
      )
      const cls = shifts.reduce((sum, s) => sum + s.value, 0)
      expect(cls, `layout shifts: ${JSON.stringify(shifts)}`).toBe(0)
    })
  }
})

test.describe("components grid", () => {
  test("new title, lede and card copy, no Tailwind", async ({ page }) => {
    await open(page, 1440)
    const grid = section(page, "Try the components here")
    await expect(grid).toHaveCount(1)
    await expect(grid).toContainText(
      "This is adaptv running on this page, the same code that ships to a phone. Drag, swipe, spin. They come unstyled, so the look is yours.",
    )
    for (const [title, line] of [
      [
        "Swipe a row",
        "Follows your finger, leaves vertical scrolling alone, and keeps one row open at a time.",
      ],
      [
        "Spin the wheel",
        "Flick it: it coasts, slows down and settles on a value without a jump.",
      ],
      [
        "Open a sheet",
        "Pull it down to close it. On a phone it stays above the keyboard; on Android, Back closes it.",
      ],
      [
        "Flip a switch",
        "Screen readers get the label and the state. On a phone you feel a haptic tick.",
      ],
    ] as const) {
      await expect.soft(grid.getByText(title, { exact: true })).toBeVisible()
      await expect.soft(grid.getByText(line, { exact: true })).toBeAttached()
    }
    await expect(grid).not.toContainText("Tailwind")
    //the board kept v3's cards: each demo sits on the dotted canvas
    await expect(grid.locator(".dots")).toHaveCount(4)
  })
})
