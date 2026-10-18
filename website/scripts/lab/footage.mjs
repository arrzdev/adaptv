//Real product footage for /lab/visuals: adaptv's own apps, driven by a script in headless
//Chrome, recorded frame by frame and placed in device frames.
//
//  TMPDIR=/tmp/vis node scripts/lab/footage.mjs [rec|plate] [name ...]
//
//Two servers must be up first, each on a free port (override with PLAYGROUND_URL / SITE_URL):
//  playground: cd playground/apps/frontend && pnpm exec vite --port 47831 --strictPort
//  website:    cd website && node_modules/.bin/vite --port 47832 --strictPort
//
//`rec` records the raw sessions into WORK; `plate` frames them and writes the deliverables
//to public/lab/footage/. With neither, both run.

import { existsSync } from "node:fs"
import { join } from "node:path"
import { encode, IPHONE, OUT, record, WORK } from "./lib.mjs"
import {
  browser,
  composite,
  dataUrl,
  IPHONE_BARS,
  page,
  phone,
} from "./plates.mjs"

const PLAYGROUND = process.env.PLAYGROUND_URL ?? "http://localhost:47831"
const SITE = process.env.SITE_URL ?? "http://localhost:47832"
const FOOTAGE = join(OUT, "footage")
const raw = (name) => join(WORK, `${name}.mp4`)

const TASKS = [
  ["Book the dentist", "High"],
  ["Water the monstera", "Low"],
  ["Reply to the landlord", "Medium"],
  ["Renew passport", "Urgent"],
]

/** Fills the playground's task list through its own sheet, before the camera rolls. */
async function seedTasks({ page: p }) {
  for (const [text, priority] of TASKS) {
    await p.getByRole("button", { name: "Create task" }).click()
    await p.getByRole("textbox", { name: "Task description" }).fill(text)
    await p.getByRole("button", { name: priority, exact: true }).click()
    await p.getByRole("button", { name: "Add task" }).click()
    await p.waitForTimeout(600)
  }
  await p.waitForTimeout(600)
}

/** Open the sheet, write a task, add it, then swipe a row and tick one off. */
async function tasksFlow(h, { swipeWidth }) {
  const p = h.page
  await h.wait(700)
  await h.tap(p.getByRole("button", { name: "Create task" }))
  await h.wait(650)
  await h.tap(p.getByRole("textbox", { name: "Task description" }))
  await h.type("Pick up the film rolls", 55)
  await h.wait(250)
  await h.tap(p.getByRole("button", { name: "Medium", exact: true }))
  await h.wait(300)
  await h.tap(p.getByRole("button", { name: "Add task" }))
  await h.wait(1100)
  //swipe a row open to its actions, then close it again
  const row = p.getByRole("button", { name: /^Water the monstera/ })
  const box = await row.boundingBox()
  const y = box.y + box.height / 2
  const x = box.x + box.width * 0.8
  await h.drag([x, y], [x - swipeWidth, y], 520)
  await h.wait(900)
  await h.drag([x - swipeWidth * 0.9, y], [x, y], 420)
  await h.wait(500)
  //tick one off
  const card = p.getByRole("button", { name: /^Book the dentist/ })
  await h.tap(
    card
      .locator("xpath=..")
      .getByRole("checkbox", { name: "Mark complete" })
      .first(),
  )
  await h.wait(1300)
}

const RECORDINGS = {
  //the playground (a real adaptv app) on a phone
  "pg-phone": () =>
    record("pg-phone", {
      ...IPHONE,
      url: `${PLAYGROUND}/`,
      setup: seedTasks,
      act: (h) => tasksFlow(h, { swipeWidth: 170 }),
    }),
  //the same app in a desktop browser
  "pg-desktop": () =>
    record("pg-desktop", {
      url: `${PLAYGROUND}/`,
      viewport: { width: 1200, height: 760 },
      dpr: 1,
      pointer: "arrow",
      setup: seedTasks,
      act: (h) => tasksFlow(h, { swipeWidth: 200 }),
    }),
  //this website on a desktop: down the landing, a row swiped, over to the docs
  "site-desktop": () =>
    record("site-desktop", {
      url: `${SITE}/`,
      viewport: { width: 1280, height: 800 },
      dpr: 1,
      pointer: "arrow",
      async act(h) {
        const p = h.page
        await h.move([640, 500], [700, 420], 500)
        await h.wait(600)
        await h.wheel(1650, 2200)
        await h.wait(700)
        const row = p.getByText("Standup moved to 10:30").first()
        const b = await row.boundingBox()
        await h.move([700, 420], [b.x + 250, b.y + 10], 500)
        await h.drag([b.x + 250, b.y + 10], [b.x + 30, b.y + 10], 600)
        await h.wait(900)
        const docs = p.getByRole("link", { name: "Docs", exact: true }).first()
        const d = await docs.boundingBox()
        await h.move([b.x + 30, b.y + 10], [d.x + 20, d.y + 14], 600)
        await docs.click()
        await h.wait(1500)
        await h.wheel(500, 900)
        await h.wait(800)
      },
    }),
  //this website on a phone: a touch scroll down the landing, a row swiped, the sheet opened
  "site-phone": () =>
    record("site-phone", {
      ...IPHONE,
      url: `${SITE}/`,
      async act(h) {
        const p = h.page
        await h.wait(500)
        await h.scroll([200, 640], -1500, 1400)
        await h.wait(500)
        const row = p.getByText("Standup moved to 10:30").first()
        await row.scrollIntoViewIfNeeded()
        const b = await row.boundingBox()
        await h.scroll([200, 640], -(b.y - 260), 800)
        await h.wait(400)
        const r = await row.boundingBox()
        await h.drag([r.x + 260, r.y + 12], [r.x + 60, r.y + 12], 520)
        await h.wait(900)
        await h.drag([r.x + 60, r.y + 12], [r.x + 270, r.y + 12], 420)
        await h.wait(500)
        const open = p.getByRole("button", { name: "Open the sheet" })
        await open.scrollIntoViewIfNeeded()
        await h.wait(300)
        await h.tap(open)
        await h.wait(1800)
      },
    }),
  //the landing's own Swipeable rows, close up
  "site-swipe": () =>
    record("site-swipe", {
      url: `${SITE}/`,
      viewport: { width: 760, height: 560 },
      dpr: 2,
      async setup(h) {
        await h.page
          .getByText("Standup moved to 10:30")
          .first()
          .scrollIntoViewIfNeeded()
        await h.wait(1200)
      },
      async act(h) {
        const p = h.page
        const rows = [
          "Standup moved to 10:30",
          "Release notes need",
          "Your build finished",
        ]
        const box = async (t) => p.getByText(t).first().boundingBox()
        let b = await box(rows[0])
        await h.wait(400)
        await h.drag([b.x + 300, b.y + 10], [b.x + 60, b.y + 10], 600)
        await h.wait(800)
        b = await box(rows[1])
        await h.drag([b.x + 120, b.y + 10], [b.x + 360, b.y + 10], 600)
        await h.wait(900)
        b = await box(rows[2])
        await h.drag([b.x + 300, b.y + 10], [b.x + 90, b.y + 10], 520)
        await h.wait(900)
        b = await box(rows[2])
        await h.drag([b.x + 90, b.y + 10], [b.x + 330, b.y + 10], 420)
        await h.wait(400)
        b = await box(rows[1])
        await h.drag([b.x + 360, b.y + 10], [b.x + 120, b.y + 10], 420)
        await h.wait(700)
      },
    }),
  //the playground's pull-to-refresh lab: a pull short of the threshold, then a full one
  "pg-ptr": () =>
    record("pg-ptr", {
      ...IPHONE,
      url: `${PLAYGROUND}/lab/pull-to-refresh`,
      async setup(h) {
        const box = h.page.getByText(/^Row 1$|^Line 1$|^Message 1$/).first()
        if (await box.count()) await box.scrollIntoViewIfNeeded()
        await h.page.evaluate(() => {
          const el = [
            ...document.querySelectorAll("[class*='rounded-md']"),
          ].find((e) => e.querySelector("[class*='h-64']"))
          el?.scrollIntoView({ block: "center" })
        })
        await h.wait(800)
      },
      async act(h) {
        const p = h.page
        const target = await p.evaluate(() => {
          const el = document.querySelector("[class*='h-64']")
          const r = el.getBoundingClientRect()
          return [r.x + r.width / 2, r.y + 40]
        })
        await h.wait(500)
        await h.drag(target, [target[0], target[1] + 60], 500)
        await h.wait(900)
        await h.drag(target, [target[0], target[1] + 190], 700, { hold: 100 })
        await h.wait(2600)
      },
    }),
  //the playground's long list under the island: a fling down, then back
  "pg-list": () =>
    record("pg-list", {
      ...IPHONE,
      url: `${PLAYGROUND}/settings`,
      async act(h) {
        const p = h.page
        await h.wait(500)
        await h.tap(p.getByText("Testing", { exact: true }))
        await h.wait(1200)
        //touch flicks: the list coasts on, under the status bar and the island
        await h.flick([200, 640], [200, 300], 120)
        await h.wait(1300)
        await h.flick([200, 620], [200, 260], 110)
        await h.wait(1500)
        await h.flick([200, 220], [200, 620], 120)
        await h.wait(1500)
      },
    }),
  //the playground's create sheet: the field, the caret, the words
  "pg-sheet": () =>
    record("pg-sheet", {
      ...IPHONE,
      url: `${PLAYGROUND}/`,
      setup: seedTasks,
      async act(h) {
        const p = h.page
        await h.wait(500)
        await h.tap(p.getByRole("button", { name: "Create task" }))
        await h.wait(700)
        await h.tap(p.getByRole("textbox", { name: "Task description" }))
        await h.wait(300)
        await h.type("Call the plumber about the kitchen tap", 60)
        await h.wait(500)
        await h.tap(p.getByRole("button", { name: "Add due date" }))
        await h.wait(1400)
      },
    }),
}

const auroraBg = () => {
  const png = join(WORK, "still-aurora.png")
  return existsSync(png)
    ? `#08080a url(${dataUrl(png)}) center/cover no-repeat`
    : "#08080a"
}

/*
 * Plates: each clip in a frame, at the size its card shows it (2x for a retina screen
 * where the budget allows).
 */
const PLATES = {
  //hero A: the playground on desktop and phone, standing level, over the rendered aurora
  async "hero-playground"() {
    const W = 1600
    const H = 960
    const html = page(
      browser({ x: 110, y: 150, w: 1100, h: 700, url: "chopchop.local" }) +
        phone({ x: 1150, y: 120, w: 340 }),
      { background: auroraBg() },
    )
    const m = await composite("hero-playground", html, {
      width: W,
      height: H,
      seconds: 12,
      clips: [
        { src: raw("pg-desktop") },
        { src: raw("pg-phone"), start: 0.4, bars: IPHONE_BARS },
      ],
    })
    encode(m, join(FOOTAGE, "hero-playground"), { kbps: 1400, posterAt: 4.2 })
  },
  //hero B: this website, desktop and phone, on the page's own dark
  async "hero-site"() {
    const W = 1600
    const H = 960
    const html = page(
      browser({ x: 110, y: 130, w: 1120, h: 720, url: "adaptv.tudu.dev" }) +
        phone({ x: 1160, y: 110, w: 340 }),
      {
        background:
          "radial-gradient(70% 60% at 50% 40%, #1a1a2e 0%, #08080a 75%)",
      },
    )
    const m = await composite("hero-site", html, {
      width: W,
      height: H,
      seconds: 11,
      clips: [
        { src: raw("site-desktop") },
        { src: raw("site-phone"), bars: IPHONE_BARS },
      ],
    })
    encode(m, join(FOOTAGE, "hero-site"), { kbps: 1400, posterAt: 0.6 })
  },
  //targets C: one app on four screens at once
  async "targets-four"() {
    const W = 1600
    const H = 660
    const html = page(
      browser({ x: 40, y: 120, w: 560, h: 380, url: "chopchop.local" }) +
        browser({
          x: 640,
          y: 120,
          w: 420,
          h: 380,
          url: "ChopChop",
          app: true,
        }) +
        phone({ x: 1110, y: 60, w: 210 }) +
        phone({ x: 1350, y: 60, w: 210, android: true }) +
        [
          ["Web", 40, 560],
          ["PWA", 640, 420],
          ["App Store", 1110, 222],
          ["Google Play", 1350, 222],
        ]
          .map(
            ([t, x, w]) =>
              `<div class="cap" style="left:${x}px;top:${H - 90}px;width:${w}px">${t}</div>`,
          )
          .join(""),
    )
    const m = await composite("targets-four", html, {
      width: W,
      height: H,
      seconds: 12,
      clips: [
        { src: raw("pg-desktop") },
        { src: raw("pg-desktop"), start: 2, crop: "760:630:220:0" },
        { src: raw("pg-phone"), bars: IPHONE_BARS },
        { src: raw("pg-phone"), start: 1.5, bars: IPHONE_BARS },
      ],
    })
    encode(m, join(FOOTAGE, "targets-four"), { kbps: 1300, posterAt: 4 })
  },
  //gestures A: the landing's Swipeable rows, close up, no frame: the card's stage, cut
  //out of the 2x recording (CSS px 60,220 → 700,520)
  async "gestures-swipe"() {
    const html = page(
      '<div class="screen" style="left:0;top:0;width:1280px;height:600px"></div>',
    )
    const m = await composite("gestures-swipe", html, {
      width: 1280,
      height: 600,
      seconds: 9,
      clips: [{ src: raw("site-swipe"), crop: "1280:600:120:440" }],
    })
    encode(m, join(FOOTAGE, "gestures-swipe"), { kbps: 900, posterAt: 2.4 })
  },
  //gestures B / keyboard A / safe areas A: one phone on the card's surface
  ...Object.fromEntries(
    [
      ["gestures-ptr", "pg-ptr", 7.5, 2.2],
      ["keyboard-sheet", "pg-sheet", 7.5, 4.6],
      ["safe-list", "pg-list", 7.5, 3],
    ].map(([name, clip, seconds, posterAt]) => [
      name,
      async () => {
        const html = page(phone({ x: 221, y: 50, w: 340 }), {
          background: "#141418",
        })
        const m = await composite(name, html, {
          width: 800,
          height: 860,
          seconds,
          clips: [{ src: raw(clip), bars: IPHONE_BARS }],
        })
        encode(m, join(FOOTAGE, name), { kbps: 900, posterAt })
      },
    ]),
  ),
}

const [mode, ...names] = process.argv.slice(2)
const pick = (table) =>
  Object.entries(table).filter(([n]) => names.length === 0 || names.includes(n))
if (!mode || mode === "rec") for (const [, run] of pick(RECORDINGS)) await run()
if (!mode || mode === "plate") for (const [, run] of pick(PLATES)) await run()
