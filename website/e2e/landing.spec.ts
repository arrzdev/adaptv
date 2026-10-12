import { readFileSync } from "node:fs"
import { expect, type Locator, type Page, test } from "@playwright/test"

//The landing after landing-v2 (TUD-733 doc `landing-v2`, task TUD-735): the hero shows "Tally",
//one budget app drawn in HTML/CSS as a desktop browser window and as a phone, then come
//Where it runs, the components grid, From idea to installed and the closing quick start.
//"Built with adaptv" is gone. Layout is read from the rendered boxes, not from class names.

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
})

test.describe("section order", () => {
  test("hero, where it runs, components, idea to installed, quick start", async ({
    page,
  }) => {
    await open(page, 1440)
    const headings = await page
      .locator(":is(h1, h2):not(header *, footer *)")
      .evaluateAll((els) =>
        els.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, " ").trim()),
      )
    expect(headings).toEqual([
      "Write React once Feel native everywhere.",
      "Where it runs",
      "Try the components here",
      "From idea to installed app",
      "Start with the quick start",
    ])
    await expect(page.getByText("Built with adaptv")).toHaveCount(0)
  })

  for (const width of [320, 390, 768, 1440]) {
    test(`no horizontal scroll at ${width} px`, async ({ page }) => {
      await open(page, width)
      await expect(page.getByRole("heading", { name: "Where it runs" })).toBeAttached()
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

//Each line was checked against docs/design/behaviors.md and the docs on main (TUD-735).
//A line that is not true on main is dropped here and named in the PR body: "No grey flash
//when you tap." is gone, because adaptv clears the tap highlight on links only (patches.css),
//not on buttons or Pressable.
const WHERE: { title: string; lines: string[] }[] = [
  {
    title: "In a browser tab",
    lines: [
      "Inputs don't zoom the page when they get focus.",
      "Scrolling a list doesn't drag the page behind it.",
    ],
  },
  {
    title: "Installed from the browser",
    lines: [
      "Installs from the browser, no store.",
      "Works offline.",
      "Fixes reach users without a store review.",
    ],
  },
  {
    title: "In the App Store and Google Play",
    lines: [
      "Real iOS and Android builds through Capacitor.",
      "Safe areas and the keyboard are handled.",
      "Android's Back button closes the open sheet first.",
    ],
  },
]

test.describe("Where it runs", () => {
  test("title, lede, three columns and their lines", async ({ page }) => {
    await open(page, 1440)
    const where = section(page, "Where it runs")
    await expect(where).toHaveCount(1)
    await expect(where).toContainText(
      "The same code reaches people three ways. adaptv handles what each one gets wrong by default.",
    )
    const titles = where.getByRole("heading", { level: 3 })
    await expect(titles).toHaveText(WHERE.map((c) => c.title))
    for (const column of WHERE) {
      const list = where.locator("li", { hasText: column.lines[0] }).locator("xpath=..")
      await expect(list.locator("li")).toHaveText(column.lines)
    }
    //three columns side by side on desktop
    expect(await rows(titles)).toHaveLength(1)
  })

  test("the six platform marks: one row on desktop, 3 × 2 on a phone", async ({ page }) => {
    await open(page, 1440)
    const marks = section(page, "Where it runs")
      .getByRole("list")
      .first()
      .getByRole("listitem")
    await expect(marks).toHaveText(["iOS", "Android", "Windows", "macOS", "PWA", "Capacitor"])
    expect(await rows(marks)).toHaveLength(1)

    await page.setViewportSize({ width: 390, height: 900 })
    expect(await rows(marks)).toHaveLength(2)
    //and the columns stack
    const titles = section(page, "Where it runs").getByRole("heading", { level: 3 })
    expect(await rows(titles)).toHaveLength(3)
  })
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

const PICKER = readFileSync(
  new URL(
    "../../playground/apps/frontend/src/components/todos/priority-picker.tsx",
    import.meta.url,
  ),
  "utf8",
)

/**
 * The JSX tags an excerpt leaves open, in order: `<Name` pushes, `/>` and `</Name>` pop.
 * Empty when the excerpt starts and ends on whole elements (TUD-865).
 */
function openTags(code: string) {
  const stack: string[] = []
  for (const [, close, name, selfClose] of code.matchAll(/<(\/?)([A-Za-z][\w.]*)|(\/>)/g)) {
    if (selfClose || close) stack.pop()
    else stack.push(name)
  }
  return stack
}

/** The Reveal that wraps the step tabs (`components/reveal.tsx`). */
function revealOf(idea: Locator) {
  return idea.locator("[data-reveal]").filter({ has: idea.page().getByRole("tablist") })
}

/** A Reveal's computed opacity and vertical offset, in CSS px. */
function motionOf(reveal: Locator) {
  return reveal.evaluate((el) => {
    const cs = getComputedStyle(el)
    const m = new DOMMatrixReadOnly(cs.transform === "none" ? undefined : cs.transform)
    return { opacity: Number(cs.opacity), y: m.m42 }
  })
}

test.describe("From idea to installed", () => {
  test("Write shows a 12–20 line excerpt of the real file, without a scroll box", async ({
    page,
  }) => {
    await open(page, 1440)
    const idea = section(page, "From idea to installed app")
    await expect(idea).toContainText(
      "Write React, run it on your phone, ship it to the web, iOS and Android.",
    )
    await expect(idea.getByRole("tab")).toHaveText(["Write", "Run", "Ship"])
    await expect(idea.getByRole("tab", { name: "Write" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
    const panel = idea.getByRole("tabpanel")
    await expect(panel).toContainText(
      "Plain React components. Behaviour comes from props, looks from className.",
    )
    const code = panel.locator("pre").first()
    const text = (await code.innerText()).replace(/\n+$/, "")
    const lines = text.split("\n")
    expect(lines.length, "excerpt line count").toBeGreaterThanOrEqual(12)
    expect(lines.length, "excerpt line count").toBeLessThanOrEqual(20)
    //every line is the playground file's own, not a copy that drifts
    for (const line of lines.filter((l) => l.trim()))
      expect.soft(PICKER, "line comes from priority-picker.tsx").toContain(line)
    //whole elements: nothing left open, and the last line closes one (TUD-865)
    expect.soft(openTags(text), "tags left open in the excerpt").toEqual([])
    expect
      .soft(lines.at(-1)?.trim(), "the last line closes an element")
      .toMatch(/^<\/[\w.]+>$|\/>$/)
    const overflow = await code.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))
    expect(overflow.scrollHeight, "no inner vertical scroll").toBeLessThanOrEqual(
      overflow.clientHeight + 1,
    )
  })

  test("the tabs fade up as they scroll in, frame by frame", async ({ page }) => {
    await open(page, 1440)
    const idea = section(page, "From idea to installed app")
    const reveal = revealOf(idea)
    await expect(reveal, "one Reveal wraps the tabs").toHaveCount(1)
    //below the fold on load: hidden and 24 px low, waiting for its entrance
    expect(await motionOf(reveal)).toEqual({ opacity: 0, y: 24 })

    //every frame from before the scroll until the 0.7 s fade has long ended
    await reveal.evaluate((el) => {
      const w = window as unknown as { revealPath: { opacity: number; y: number }[] }
      w.revealPath = []
      const t0 = performance.now()
      const tick = () => {
        const cs = getComputedStyle(el)
        const m = new DOMMatrixReadOnly(cs.transform === "none" ? undefined : cs.transform)
        w.revealPath.push({ opacity: Number(cs.opacity), y: m.m42 })
        if (performance.now() - t0 < 1800) requestAnimationFrame(tick)
        else document.documentElement.dataset.revealSampled = ""
      }
      requestAnimationFrame(tick)
    })
    await idea.getByRole("tablist").scrollIntoViewIfNeeded()
    await page.locator("html[data-reveal-sampled]").waitFor({ state: "attached" })
    const path = await page.evaluate(
      () => (window as unknown as { revealPath: { opacity: number; y: number }[] }).revealPath,
    )

    expect(path[0], "starts hidden and low").toEqual({ opacity: 0, y: 24 })
    expect(path.at(-1), "ends in place").toEqual({ opacity: 1, y: 0 })
    const between = path.filter((f) => f.opacity > 0 && f.opacity < 1)
    //a fade, not a jump: at 60 fps the 0.7 s ease paints about 40 frames
    expect(between.length, "frames in mid-fade").toBeGreaterThanOrEqual(8)
    for (let i = 1; i < path.length; i++) {
      const [a, b] = [path[i - 1], path[i]]
      expect.soft(b.opacity, `frame ${i}: opacity only rises`).toBeGreaterThanOrEqual(a.opacity)
      expect.soft(b.y, `frame ${i}: it only moves up`).toBeLessThanOrEqual(a.y + 0.01)
      expect.soft(b.y, `frame ${i}: no overshoot past its place`).toBeGreaterThanOrEqual(0)
      //no frame that drops it in place while still invisible, or shows it fully while low
      if (b.opacity === 1) expect.soft(b.y, `frame ${i}: opaque only in place`).toBeLessThan(1)
    }
  })

  test("under reduced motion the tabs are in place from the start", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await open(page, 1440)
    const reveal = revealOf(section(page, "From idea to installed app"))
    await expect(reveal).toHaveCount(1)
    expect(await motionOf(reveal)).toEqual({ opacity: 1, y: 0 })
  })

  test("captions, and switching tabs moves nothing below the panel", async ({ page }) => {
    await open(page, 1440)
    const idea = section(page, "From idea to installed app")
    const tablist = idea.getByRole("tablist")
    await tablist.scrollIntoViewIfNeeded()
    //the base gap is read once the entrance has settled, not halfway up its 24 px rise
    await expect.poll(() => motionOf(revealOf(idea))).toEqual({ opacity: 1, y: 0 })
    const below = page.getByRole("heading", { name: "Start with the quick start" })
    const gap = async () => {
      const [a, b] = await Promise.all([box(tablist), box(below)])
      return Math.round(b.top - a.top)
    }
    const captions = {
      Write: "Plain React components. Behaviour comes from props, looks from className.",
      Run: "One dev server. Your phone reloads as you edit.",
      Ship: "One command builds it.",
    }
    const base = await gap()
    for (const [tab, caption] of Object.entries(captions)) {
      await idea.getByRole("tab", { name: tab }).click()
      await expect(idea.getByRole("tabpanel")).toContainText(caption)
      //sampled through the terminal replay (about 1.5 s), not only at its end
      for (let i = 0; i < 6; i++) {
        expect.soft(await gap(), `${tab} after ${i * 400} ms`).toBe(base)
        await page.waitForTimeout(400)
      }
    }
  })
})
