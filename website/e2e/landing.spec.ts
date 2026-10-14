import { expect, type Locator, type Page, test } from "@playwright/test"

//The landing after landing-v3 (TUD-889 doc `landing-v3`, task TUD-890): the hero shows "Tally",
//one budget app drawn in HTML/CSS as a desktop browser window and as a phone, then come the
//platform marks strip, the components grid, Why adaptv, How it compares and the closing quick
//start. "Where it runs", "From idea to installed app" and "Built with adaptv" are gone.
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
    test(`desktop window and phone are both visible at ${width} px`, async ({
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
      //the desktop window keeps its desktop layout at every width: laid out about 1000 px wide
      expect.soft(d.layoutWidth, "desktop layout width").toBeGreaterThanOrEqual(960)
      expect.soft(d.layoutWidth, "desktop layout width").toBeLessThanOrEqual(1040)
      expect.soft(d.right, "desktop window inside the viewport").toBeLessThanOrEqual(d.innerWidth)
      expect.soft(d.left, "desktop window inside the viewport").toBeGreaterThanOrEqual(0)
      expect.soft(p.right, "phone inside the viewport").toBeLessThanOrEqual(p.innerWidth)
      //the phone overlaps the window's bottom-right corner
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
        //scaled down to the content width; the phone is about 46 % of it
        expect.soft(d.width, "window fills the content width").toBeGreaterThanOrEqual(s.width * 0.9)
        expect.soft(p.width / s.width, "phone about 46 % of the width").toBeGreaterThanOrEqual(0.38)
        expect.soft(p.width / s.width, "phone about 46 % of the width").toBeLessThanOrEqual(0.55)
      }

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
const WHY_TITLE = "One React app. At home on every screen."
const COMPARE_TITLE = "Good tools exist. adaptv picks a different trade."

test.describe("section order", () => {
  test("hero, strip, components, why adaptv, how it compares, quick start", async ({
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
      WHY_TITLE,
      COMPARE_TITLE,
      "Start with the quick start",
    ])
    for (const gone of ["Where it runs", "From idea to installed app", "Built with adaptv"])
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

const WHY_BODY =
  "Most teams build their app twice: once for the web, once for phones. Or they wrap a website in an app shell, and users can tell. adaptv lets you write your app once, in ordinary React, and gives each platform what it expects: the gestures, the sheets, the back button, the safe areas, the offline mode, the home-screen icon."

const WHY_POINTS = [
  [
    "One codebase.",
    "Desktop web, mobile web, an installable home-screen app, and iOS and Android apps.",
  ],
  [
    "Feels native, not wrapped.",
    "Drawers, swipes, pull-to-refresh and keyboards behave the way each phone does.",
  ],
  [
    "The web stays first.",
    "It is still the web: your CSS, your React libraries, your browser tools.",
  ],
] as const

const WHY_ART =
  "One React file becomes the same app on a desktop browser, a phone browser, an iPhone and an Android phone."

/** The illustration's layout: reserved box, CSS aspect-ratio and what it is drawn with. */
function art(locator: Locator) {
  return locator.evaluate((el) => ({
    aspectRatio: getComputedStyle(el).aspectRatio,
    svg: el.querySelectorAll("svg").length,
    raster: el.querySelectorAll("img, picture, canvas, video, iframe, svg image").length,
  }))
}

/** An eyebrow: a short line above the section's title. */
async function expectEyebrow(sec: Locator, text: string, title: string) {
  const eyebrow = sec.getByText(text, { exact: true })
  await expect(eyebrow).toBeVisible()
  const [e, h] = await Promise.all([
    box(eyebrow),
    box(sec.getByRole("heading", { level: 2, name: title })),
  ])
  expect(e.bottom, "eyebrow above the title").toBeLessThanOrEqual(h.top)
}

test.describe("Why adaptv", () => {
  test("eyebrow, title, body and the three points", async ({ page }) => {
    await open(page, 1440)
    const why = section(page, WHY_TITLE)
    await expect(why).toHaveCount(1)
    await expectEyebrow(why, "Why adaptv", WHY_TITLE)
    await expect(why).toContainText(WHY_BODY)
    const points = why.getByRole("listitem")
    await expect(points).toHaveText(WHY_POINTS.map(([lead, line]) => `${lead} ${line}`))
    for (const [lead] of WHY_POINTS)
      await expect.soft(why.getByText(lead, { exact: true }), `${lead} is its own run`).toBeVisible()
    //no code and no step list: a drawing and three points
    await expect(why.locator("pre, code, ol, [role=tablist]")).toHaveCount(0)
  })

  for (const width of [390, 1440]) {
    test(`one SVG drawing with a fixed aspect ratio at ${width} px`, async ({ page }) => {
      await open(page, width)
      const why = section(page, WHY_TITLE)
      const drawing = why.getByRole("img", { name: WHY_ART, exact: true })
      await expect(drawing).toHaveCount(1)
      await drawing.scrollIntoViewIfNeeded()
      await expect(drawing).toBeVisible()
      const a = await art(drawing)
      expect(a.aspectRatio, "CSS aspect-ratio reserves its box").not.toBe("auto")
      expect(a.svg, "drawn in SVG").toBeGreaterThan(0)
      expect(a.raster, "no raster image").toBe(0)
      const b = await box(drawing)
      //three stages: left to right on desktop, top to bottom on a phone
      if (width >= 768) expect(b.width, "landscape on desktop").toBeGreaterThan(b.height)
      else expect(b.height, "portrait on a phone").toBeGreaterThan(b.width)
      expect(b.right, "inside the viewport").toBeLessThanOrEqual(b.innerWidth)
      //the points: one row on desktop, stacked on a phone
      expect(await rows(why.getByRole("listitem"))).toHaveLength(width >= 768 ? 1 : 3)
    })
  }
})

const COMPARE: { name: string; text: string }[] = [
  {
    name: "Expo (React Native)",
    text: "Renders real native views. Excellent native feel and a large ecosystem. The trade: you leave the web platform. Web support exists, but the web is not where it starts.",
  },
  {
    name: "Ionic",
    text: "Builds apps with web technology on top of Capacitor, with ready-made iOS and Material themes. The trade: you adopt its own components and look.",
  },
  {
    name: "adaptv",
    text: "Plain React and CSS on the web platform, with Capacitor for the native parts — the same native bridge Ionic uses. The web is the primary target, and the framework handles what each platform expects, so you don't need a second app.",
  },
]

test.describe("How it compares", () => {
  test("eyebrow, title, three cards in order, the footnote", async ({ page }) => {
    await open(page, 1440)
    const compare = section(page, COMPARE_TITLE)
    await expect(compare).toHaveCount(1)
    await expectEyebrow(compare, "How it compares", COMPARE_TITLE)
    const cards = compare.getByRole("listitem")
    await expect(cards).toHaveCount(3)
    await expect(cards.getByRole("heading", { level: 3 })).toHaveText(
      COMPARE.map((c) => c.name),
    )
    for (const [i, card] of COMPARE.entries())
      await expect.soft(cards.nth(i), card.name).toContainText(card.text)
    await expect(compare).toContainText("adaptv is pre-alpha and not yet on npm.")
    //no table of checkmarks, no code
    await expect(compare.locator("table, pre, code, ol")).toHaveCount(0)
    await expect(compare).not.toContainText(/[✓✔✗✘]/)
  })

  test("fair: no winner styling, no put-downs or numbers about the others", async ({
    page,
  }) => {
    await open(page, 1440)
    const compare = section(page, COMPARE_TITLE)
    const cards = compare.getByRole("listitem")
    await expect(cards).toHaveCount(3)
    await expect(compare).not.toContainText(/\b(recommended|best|winner)\b/i)
    for (const i of [0, 1]) {
      const text = (await cards.nth(i).innerText()).replace(/\s+/g, " ")
      expect.soft(text, `${COMPARE[i].name}: no put-downs`).not.toMatch(
        /\b(slow|dead|old|outdated|legacy|abandoned)\b/i,
      )
      expect.soft(text, `${COMPARE[i].name}: no numbers`).not.toMatch(/\d/)
    }
    //same colour for all three
    const looks = await cards.evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el)
        return [cs.backgroundColor, cs.borderTopColor, cs.borderTopWidth, cs.boxShadow].join(" | ")
      }),
    )
    expect(new Set(looks).size, `one look: ${looks.join(" / ")}`).toBe(1)
  })

  for (const width of [390, 1440]) {
    test(`three equal cards, each with one SVG drawing, at ${width} px`, async ({ page }) => {
      await open(page, width)
      const cards = section(page, COMPARE_TITLE).getByRole("listitem")
      await expect(cards).toHaveCount(3)
      await cards.first().scrollIntoViewIfNeeded()
      const sizes = await cards.evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect()
          return { width: r.width, height: r.height }
        }),
      )
      for (const s of sizes.slice(1))
        expect.soft(Math.abs(s.width - sizes[0].width), "same width").toBeLessThanOrEqual(1)
      //side by side on desktop, same height; stacked on a phone
      if (width >= 768) {
        for (const s of sizes.slice(1))
          expect.soft(Math.abs(s.height - sizes[0].height), "same height").toBeLessThanOrEqual(1)
        expect(await rows(cards)).toHaveLength(1)
      } else expect(await rows(cards)).toHaveLength(3)

      for (const [i, card] of COMPARE.entries()) {
        const drawing = cards.nth(i).getByRole("img")
        await expect.soft(drawing, `${card.name}: one drawing`).toHaveCount(1)
        await expect.soft(drawing, `${card.name}: drawing is named`).toHaveAccessibleName(/\S/)
        const a = await art(drawing)
        expect.soft(a.aspectRatio, `${card.name}: aspect-ratio`).not.toBe("auto")
        expect.soft(a.svg, `${card.name}: SVG`).toBeGreaterThan(0)
        expect.soft(a.raster, `${card.name}: no raster`).toBe(0)
      }
    })
  }
})

//landing-v3 "Zero layout shift": every layout-shift entry from the first paint through a
//scroll to the bottom and back, at a phone and a desktop width. Reveals move by transform,
//which is not a layout shift; a box that grows, a late font or an image without size is.
test.describe("zero layout shift", () => {
  for (const width of [390, 1440]) {
    test(`CLS is 0 over a full scroll at ${width} px`, async ({ page }) => {
      test.setTimeout(60_000)
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
      //down in viewport-sized steps, so every reveal and lazy part runs, then back up
      const height = await page.evaluate(() => document.documentElement.scrollHeight)
      for (let y = 0; y <= height; y += 450) {
        await page.evaluate((top) => window.scrollTo(0, top), y)
        await page.waitForTimeout(150)
      }
      await page.waitForTimeout(1000)
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(500)
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
  })
})
