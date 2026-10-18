import { expect, type Locator, type Page, test } from "@playwright/test"

//The landing after landing-v4 (doc `landing-v4`): the hero shows "Tally", one budget app drawn
//in HTML/CSS in a desktop browser window, beside a phone playing a muted loop of this site's own
//components, then come the platform marks strip,
//the components grid, "The hard parts are already decided", "Four ways to ship one app" and
//the closing quick start. Sections are centred heads over large flat cards.
//Layout is read from the rendered boxes, not from class names.

const SHOWCASE_LABEL =
  "Tally, a budget app, in a desktop browser window, beside a phone playing a recording of this site's own components."

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
      const phone = stage.getByTestId("site-phone")
      const parts = {
        sidebar: stage.getByTestId("tally-sidebar"),
        "phone screen": phone.locator("video"),
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
      //the phone screen is the recording, inside the frame, under the status bar
      const screen = await box(parts["phone screen"])
      expect.soft(screen.left, "video inside the phone").toBeGreaterThanOrEqual(p.left)
      expect.soft(screen.right, "video inside the phone").toBeLessThanOrEqual(p.right)
      expect.soft(screen.top, "video under the status bar").toBeGreaterThan(p.top + p.height * 0.05)
      expect.soft(screen.bottom, "video inside the phone").toBeLessThanOrEqual(p.bottom)
      expect.soft(screen.width / p.width, "video fills the screen's width").toBeGreaterThan(0.9)

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
      const p = await box(stage.getByTestId("site-phone"))
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

  test("the window is drawn in HTML and CSS; the only media is the phone's recording", async ({
    page,
  }) => {
    await open(page, 1440)
    const stage = showcase(page)
    await expect(stage).toBeVisible()
    await expect(stage.locator("img, picture, canvas, iframe, svg image")).toHaveCount(0)
    await expect(stage.locator("video")).toHaveCount(1)
    await expect(stage.getByTestId("site-phone").locator("video")).toHaveCount(1)
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

  test("the window draws Tally from its one data set", async ({ page }) => {
    await open(page, 1440)
    const stage = showcase(page)
    const desktop = (await stage.getByTestId("tally-desktop").textContent()) ?? ""

    for (const text of ["October", "$716", "$1,284", "$2,000"]) {
      expect.soft(desktop, `desktop shows ${text}`).toContain(text)
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
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort())
      await open(page, width)
      //no Geist face at all: the stylesheet that declares it never loaded
      expect(
        await page.evaluate(() =>
          [...document.fonts].some((f) => f.family.includes("Geist")),
        ),
      ).toBe(false)
      const fallback = await restingBox(showcase(page))
      expect(fallback.top).toBe(geist.top)
    })
  }
})

const HERO_TITLE = "Write React once Feel native everywhere."
const HARD_TITLE = "The hard parts are already decided"
const COMPARE_TITLE = "Four ways to ship one app"

test.describe("section order", () => {
  test("hero, strip, components, the hard parts, four ways, quick start", async ({
    page,
  }) => {
    await open(page, 1440)
    const headings = await page
      .locator(":is(h1, h2):not(header *, footer *)")
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, " ").trim()),
      )
    //the strip has no heading: it sits between the hero and the components grid
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

/** The section right after the hero: the platform marks strip (landing-v3 §2). */
function strip(page: Page) {
  return page.locator("section:has(h1) + section")
}

//The strip is `targets.tsx` from before #444 (64bbb23^), back in its place under the hero,
//minus the Windows and macOS marks (#448: desktop native is not built).
test.describe("platform strip", () => {
  test("four marks under the hero, no heading, no cards", async ({ page }) => {
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
  test("lede, five cards in order, each a title, a body and one recording or diagram", async ({
    page,
  }) => {
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
      expect.soft(await card.locator("img, picture, canvas, iframe").count(), `card ${i}: no image`).toBe(0)
      //the visual is decoration: the card's text carries the meaning
      const visual = card.locator(i < 2 ? "[aria-hidden]:has(> video)" : "svg[viewBox]")
      await expect.soft(visual, `card ${i}: one ${i < 2 ? "recording" : "diagram"}`).toHaveCount(1)
      await expect.soft(visual.first(), `card ${i}: hidden from assistive tech`).toHaveAttribute("aria-hidden", "true")
      if (i < 2) await expect.soft(card.locator("svg[viewBox]"), `card ${i}: no diagram`).toHaveCount(0)
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

//The screen recordings (hero phone, targets and gestures cards): muted loops that ship without
//autoplay and load nothing until they play, which is only on screen and never under reduced
//motion. Each has a poster, a still of the clip, so reduced motion still shows a picture.
const RECORDINGS = ["site-phone", "targets-fanout", "gestures-sheet"] as const

function recording(page: Page, name: string) {
  return page.locator(`video[data-loop-video="${name}"]`)
}

function videoState(video: Locator) {
  return video.evaluate((el: HTMLVideoElement) => ({
    paused: el.paused,
    muted: el.muted,
    loop: el.loop,
    autoplay: el.autoplay,
    playsInline: el.playsInline,
    controls: el.controls,
    preload: el.preload,
    poster: el.poster,
    currentTime: el.currentTime,
    sources: [...el.querySelectorAll("source")].map((s) => s.type),
  }))
}

test.describe("screen recordings", () => {
  test("each is a muted, inline, looping clip with a poster, a webm and an mp4", async ({ page }) => {
    await open(page, 1440)
    for (const name of RECORDINGS) {
      const video = recording(page, name)
      await expect(video, name).toHaveCount(1)
      const v = await videoState(video)
      expect.soft(v, name).toMatchObject({
        muted: true,
        loop: true,
        autoplay: false,
        playsInline: true,
        controls: false,
        preload: "none",
        sources: ["video/webm", "video/mp4"],
      })
      expect.soft(v.poster, `${name} poster`).toMatch(new RegExp(`/media/${name}\\.webp$`))
      const poster = await page.request.get(`/media/${name}.webp`)
      expect.soft(poster.status(), `${name} poster is served`).toBe(200)
    }
  })

  test("the hero's plays on load; a card's plays only once it is on screen", async ({ page }) => {
    const fetched: string[] = []
    page.on("request", (r) => {
      if (/\/media\/.+\.(webm|mp4)$/.test(r.url())) fetched.push(new URL(r.url()).pathname)
    })
    await open(page, 1440)
    const hero = recording(page, "site-phone")
    await expect.poll(async () => (await videoState(hero)).currentTime, "hero plays").toBeGreaterThan(0.2)
    const gestures = recording(page, "gestures-sheet")
    expect((await videoState(gestures)).paused, "off-screen card is paused").toBe(true)
    expect(fetched.filter((u) => u.includes("gestures-sheet")), "off-screen card loads nothing").toEqual([])
    await gestures.scrollIntoViewIfNeeded()
    await expect.poll(async () => (await videoState(gestures)).currentTime, "card plays on screen").toBeGreaterThan(0.2)
    //scrolled away again: it stops
    await hero.scrollIntoViewIfNeeded()
    await expect.poll(async () => (await videoState(gestures)).paused, "card pauses off screen").toBe(true)
  })

  test("under reduced motion none plays and none loads: the poster stays", async ({ page }) => {
    const fetched: string[] = []
    page.on("request", (r) => {
      if (/\/media\/.+\.(webm|mp4)$/.test(r.url())) fetched.push(new URL(r.url()).pathname)
    })
    await page.emulateMedia({ reducedMotion: "reduce" })
    await open(page, 1440)
    for (const name of RECORDINGS) {
      const video = recording(page, name)
      await video.scrollIntoViewIfNeeded()
      //give a play() the time it would take
      await page.waitForTimeout(500)
      const v = await videoState(video)
      expect.soft(v.paused, `${name} paused`).toBe(true)
      expect.soft(v.currentTime, `${name} at its first frame`).toBe(0)
    }
    expect(fetched, "no clip fetched").toEqual([])
  })

  test("the clips weigh under 1 MB together, every format counted", async ({ page }) => {
    let total = 0
    for (const name of RECORDINGS)
      for (const ext of ["webm", "mp4", "webp"]) {
        const res = await page.request.get(`/media/${name}.${ext}`)
        expect.soft(res.status(), `${name}.${ext}`).toBe(200)
        total += (await res.body()).length
      }
    expect(total).toBeLessThan(1_000_000)
  })
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
