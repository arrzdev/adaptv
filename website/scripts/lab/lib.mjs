//Shared helpers for the /lab/visuals asset scripts. Nothing here ships: the scripts write
//files under public/lab/ and those files are what the review page shows.
//
//Requires: Chromium for Playwright (`pnpm exec playwright install chromium` in website/) and
//an ffmpeg with libx264, libvpx-vp9, libwebp and libaom-av1 (FFMPEG=/path overrides).
//Headless Chrome needs a short TMPDIR (a long one breaks its socket path): TMPDIR=/tmp/vis.

import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "@playwright/test"

const here = dirname(fileURLToPath(import.meta.url))
export const WEBSITE = resolve(here, "../..")
export const OUT = join(WEBSITE, "public/lab")
export const WORK = process.env.LAB_WORK ?? "/tmp/vis/work"

const LOCAL_FFMPEG = "/home/paperclip/.local/bin/ffmpeg"
export const FFMPEG =
  process.env.FFMPEG ?? (existsSync(LOCAL_FFMPEG) ? LOCAL_FFMPEG : "ffmpeg")

/** Width and height of a video's first stream. */
export function probe(file) {
  const out = execFileSync(
    FFMPEG.replace(/ffmpeg$/, "ffprobe"),
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  )
  const [w, h] = out.trim().split(",").map(Number)
  return { w, h }
}

export function ffmpeg(args) {
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    stdio: "inherit",
  })
}

export function fresh(dir) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

export function kb(file) {
  return `${(statSync(file).size / 1024).toFixed(0)} KB`
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ dpr } = {}) {
  const browser = await chromium.launch({
    args: [
      "--enable-unsafe-swiftshader",
      "--use-angle=swiftshader",
      //the screencast sends frames in CSS pixels unless the whole browser is at this scale
      ...(dpr ? [`--force-device-scale-factor=${dpr}`] : []),
    ],
  })
  //a script error inside a rendered page would otherwise just give a black frame
  const newPage = browser.newPage.bind(browser)
  browser.newPage = async (...args) => {
    const page = await newPage(...args)
    page.on("pageerror", (e) => console.error(`  page error: ${e.message}`))
    return page
  }
  return browser
}

/*
 * The finger: a soft disc drawn inside the page under the pointer while a button is down,
 * so a recorded drag reads as a touch. Pointer events, so it follows `page.mouse`.
 */
const FINGER = `(() => {
  const add = () => {
    const d = document.createElement("div")
    d.id = "__finger"
    d.style.cssText = "position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(255,255,255,.28);box-shadow:0 0 0 1.5px rgba(255,255,255,.55),0 6px 20px rgba(0,0,0,.35);pointer-events:none;z-index:2147483647;opacity:0;transform:scale(.6);transition:opacity .15s,transform .15s"
    document.documentElement.appendChild(d)
    const at = (e) => { d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px" }
    addEventListener("pointerdown", (e) => { at(e); d.style.opacity = "1"; d.style.transform = "scale(1)" }, true)
    addEventListener("pointermove", at, true)
    addEventListener("pointerup", () => { d.style.opacity = "0"; d.style.transform = "scale(.6)" }, true)
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", add)
  else add()
})()`

/** A desktop pointer: an arrow that follows the mouse, for recordings without touch. */
const ARROW = `(() => {
  const add = () => {
    const d = document.createElement("div")
    d.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2.5v17.2l4.6-4.3 2.9 6.6 2.8-1.2-2.9-6.5h6.3z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/></svg>'
    d.style.cssText = "position:fixed;left:-40px;top:-40px;margin:-3px 0 0 -4px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))"
    document.documentElement.appendChild(d)
    addEventListener("pointermove", (e) => { d.style.left = e.clientX + "px"; d.style.top = e.clientY + "px" }, true)
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", add)
  else add()
})()`

/*
 * A heartbeat: one corner pixel that changes every frame, so the screencast sends a frame
 * per vsync even when the page is still. A gap in the frames then means the renderer
 * stalled (this VM is shared and its load spikes), and record() takes the clip again.
 */
const HEARTBEAT = `(() => {
  const add = () => {
    const d = document.createElement("div")
    d.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;pointer-events:none;z-index:2147483647;animation:__hb .1s steps(2) infinite"
    const s = document.createElement("style")
    s.textContent = "@keyframes __hb{from{background:#000}to{background:#020202}}"
    document.documentElement.append(s, d)
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", add)
  else add()
})()`

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** Helpers a scenario drives the page with: timed, eased, visible. */
export function hands(page, cdp, touch = false) {
  //on a touch screen the finger is a real touch (CDP touch events), not a mouse
  const point = (x, y) => [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }]
  const down = async (x, y) => {
    if (touch)
      return cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: point(x, y),
      })
    await page.mouse.move(x, y)
    await page.mouse.down()
  }
  const moveTo = (x, y) =>
    touch
      ? cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: point(x, y),
        })
      : page.mouse.move(x, y)
  const up = () =>
    touch
      ? cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        })
      : page.mouse.up()
  return {
    page,
    /** a real touch scroll (touch events, momentum and all) by `dy` px, up when negative */
    async scroll([x, y], dy, speed = 900) {
      await cdp.send("Input.synthesizeScrollGesture", {
        x,
        y,
        yDistance: dy,
        speed,
        gestureSourceType: "touch",
        repeatCount: 1,
      })
    },
    /** a mouse wheel scroll, in small steps so it reads as a hand on a trackpad */
    async wheel(dy, ms = 800) {
      const steps = Math.max(6, Math.round(ms / 30))
      for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, dy / steps)
        await page.waitForTimeout(ms / steps)
      }
    },
    /** moves the mouse (the arrow) to a point over `ms` */
    async move([x0, y0], [x1, y1], ms = 500) {
      const steps = Math.max(8, Math.round(ms / 16))
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps)
        await page.mouse.move(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
        await page.waitForTimeout(ms / steps)
      }
    },
    wait: (ms) => page.waitForTimeout(ms),
    /** a press-and-drag from one point to another over `ms`, eased like a hand */
    async drag(
      [x0, y0],
      [x1, y1],
      ms = 600,
      { hold = 120, release = true } = {},
    ) {
      await down(x0, y0)
      await page.waitForTimeout(hold)
      const steps = Math.max(8, Math.round(ms / 16))
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps)
        await moveTo(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
        await page.waitForTimeout(ms / steps)
      }
      if (release) await up()
    },
    /** a quick flick: linear and fast, released while still moving */
    async flick([x0, y0], [x1, y1], ms = 140) {
      await down(x0, y0)
      const steps = 8
      for (let i = 1; i <= steps; i++) {
        await moveTo(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps)
        await page.waitForTimeout(ms / steps)
      }
      await up()
    },
    /** a tap on an element's centre, with the finger shown */
    async tap(locator, hold = 110) {
      const box = await locator.boundingBox()
      if (!box) throw new Error(`nothing to tap: ${locator}`)
      const x = box.x + box.width / 2
      const y = box.y + box.height / 2
      await down(x, y)
      await page.waitForTimeout(hold)
      await up()
    },
    async type(text, perKey = 70) {
      await page.keyboard.type(text, { delay: perKey })
    },
  }
}

/**
 * An iPhone 15/16 (393 x 852 pt) less its status bar (59) and home indicator (34): the
 * plate draws those two around the recording, where an installed app pads its content.
 * (Chrome cannot emulate `display-mode: standalone`, which adaptv's `app:` padding keys on.)
 */
export const IPHONE = {
  viewport: { width: 393, height: 759 },
  dpr: 1.5,
  mobile: true,
}

/**
 * Records a scripted session with the DevTools screencast: a frame per paint, each with its
 * own timestamp, rebuilt into a constant-rate, near-lossless MP4 in WORK. Sharper than
 * `recordVideo` (which encodes once, at a low bitrate) and at the page's device scale.
 */
export async function record(name, options) {
  const maxGap = options.maxGap ?? 0.3
  const attempts = options.attempts ?? 10
  let best
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const take = await recordOnce(name, options).catch((e) => {
      console.log(`  rec ${name}: ${e.message.split("\n")[0]}`)
      return { gap: Number.POSITIVE_INFINITY }
    })
    if (take.gap === Number.POSITIVE_INFINITY) continue
    if (!best || take.gap < best.gap) {
      best = take
      renameSync(take.raw, join(WORK, `${name}.mp4`))
    }
    if (take.gap <= maxGap) break
    console.log(`  rec ${name}: a ${take.gap.toFixed(2)} s stall, again`)
  }
  if (!best) throw new Error(`${name}: no usable take`)
  if (best.gap > maxGap)
    console.log(
      `  rec ${name}: kept the best take, a ${best.gap.toFixed(2)} s stall`,
    )
  return join(WORK, `${name}.mp4`)
}

async function recordOnce(
  name,
  {
    url,
    viewport,
    dpr = 2,
    mobile = false,
    colorScheme = "dark",
    setup,
    act,
    pointer = "finger",
    tail = 600,
  },
) {
  const dir = fresh(join(WORK, "rec", name))
  const browser = await launch({ dpr })
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme,
    reducedMotion: "no-preference",
  })
  await context.addInitScript(HEARTBEAT)
  if (pointer === "finger") await context.addInitScript(FINGER)
  if (pointer === "arrow") await context.addInitScript(ARROW)
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await page.goto(url, { waitUntil: "networkidle" })
  await page.waitForTimeout(800)
  if (setup) await setup(hands(page, cdp, mobile))
  const frames = []
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`)
    frames.push({ file, t: metadata.timestamp })
    writeFileSync(file, Buffer.from(data, "base64"))
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {})
  })
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    maxWidth: Math.round(viewport.width * dpr),
    maxHeight: Math.round(viewport.height * dpr),
  })
  //nudge a first frame out of a still page
  await page.evaluate(() => {
    document.documentElement.style.outline = "0 solid transparent"
  })
  const start = Date.now()
  await act(hands(page, cdp, mobile))
  await page.waitForTimeout(tail)
  const seconds = (Date.now() - start) / 1000
  await cdp.send("Page.stopScreencast")
  await browser.close()
  if (frames.length === 0) throw new Error(`${name}: no frames`)
  //concat demuxer: each frame lasts until the next one arrived
  const t0 = frames[0].t
  const end = t0 + seconds
  const lines = []
  let gap = 0
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : end
    gap = Math.max(gap, next - f.t)
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, next - f.t)}`)
  })
  lines.push(`file '${frames.at(-1).file}'`)
  const list = join(dir, "list.txt")
  writeFileSync(list, lines.join("\n"))
  const raw = join(WORK, `${name}.take.mp4`)
  ffmpeg([
    ...["-f", "concat", "-safe", "0", "-i", list],
    ...["-vf", "fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p"],
    ...["-c:v", "libx264", "-crf", "12", "-preset", "fast", raw],
  ])
  console.log(
    `  rec ${name}: ${frames.length} frames, ${seconds.toFixed(1)} s, longest gap ${gap.toFixed(2)} s`,
  )
  return { raw, gap }
}

/**
 * Steps a page's `draw(t)` through `t` = 0 → 1 and screenshots its first canvas (or the
 * whole page) per frame; returns a near-lossless MP4. Time comes from the script, never
 * a clock, so a loaded machine renders the same frames, only slower.
 */
export async function renderFrames(
  name,
  html,
  { width, height, seconds, fps = 30 },
) {
  const dir = fresh(join(WORK, "frames", name))
  const browser = await launch()
  const page = await browser.newPage({ viewport: { width, height } })
  await page.setContent(html, { waitUntil: "load" })
  await page.evaluate(() => document.fonts.ready)
  const frames = Math.round(seconds * fps)
  const target = (await page.locator("canvas").count())
    ? page.locator("canvas").first()
    : page
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.draw(t), i / frames)
    await target.screenshot({
      path: join(dir, `${String(i).padStart(4, "0")}.png`),
    })
  }
  await browser.close()
  const master = join(WORK, `frames-${name}.mp4`)
  ffmpeg([
    ...["-framerate", String(fps), "-i", join(dir, "%04d.png")],
    ...["-c:v", "libx264", "-crf", "10", "-preset", "fast"],
    ...["-pix_fmt", "yuv420p", master],
  ])
  console.log(`  frames ${name}: ${frames}`)
  return master
}

/**
 * Renders an HTML string in Chrome to a PNG. With `rects`, also returns the boxes of the
 * elements matching each selector, in CSS pixels, for ffmpeg to place video into.
 */
export async function renderHtml(
  html,
  { width, height, out, transparent = false, rects = [], dpr = 1 },
) {
  const browser = await launch()
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: dpr,
  })
  await page.setContent(html, { waitUntil: "load" })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(100)
  if (out) await page.screenshot({ path: out, omitBackground: transparent })
  const boxes = {}
  for (const sel of rects) {
    boxes[sel] = await page.$$eval(sel, (els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return {
          x: Math.round(r.x),
          y: Math.round(r.y),
          w: Math.round(r.width),
          h: Math.round(r.height),
          radius: Number.parseFloat(getComputedStyle(e).borderTopLeftRadius),
        }
      }),
    )
  }
  await browser.close()
  return boxes
}

/**
 * The deliverables for one clip: H.264 MP4 and VP9 WebM, muted, plus a WebP and an AVIF
 * poster taken at `posterAt` seconds. Bitrates are capped so a clip stays near 1 MB.
 */
export function encode(src, base, { posterAt = 1, kbps = 900, width } = {}) {
  mkdirSync(dirname(base), { recursive: true })
  const vf = width ? ["-vf", `scale=${width}:-2:flags=lanczos`] : []
  ffmpeg([
    "-i",
    src,
    ...vf,
    ...["-an", "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p"],
    ...["-preset", "slow", "-crf", "26", "-maxrate", `${kbps}k`],
    ...["-bufsize", `${kbps * 2}k`, "-movflags", "+faststart", `${base}.mp4`],
  ])
  ffmpeg([
    "-i",
    src,
    ...vf,
    ...["-an", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-row-mt", "1"],
    ...[
      "-crf",
      "36",
      "-b:v",
      `${Math.round(kbps * 0.8)}k`,
      "-deadline",
      "good",
    ],
    ...["-cpu-used", "2", `${base}.webm`],
  ])
  poster(src, base, posterAt, width)
  console.log(
    `  ${base.replace(`${OUT}/`, "")}: mp4 ${kb(`${base}.mp4`)}, webm ${kb(`${base}.webm`)}, webp ${kb(`${base}.webp`)}, avif ${kb(`${base}.avif`)}`,
  )
}

/**
 * A still from a video or an image: WebP and AVIF next to `base`. ffmpeg's libwebp takes
 * its quality from `-q:v` (its own `-quality` is overridden); the AVIF is 10-bit, so a
 * wide dark gradient does not band.
 */
export function poster(src, base, at = 0, width) {
  mkdirSync(dirname(base), { recursive: true })
  const scale = width ? [`scale=${width}:-2:flags=lanczos`] : []
  const seek = at ? ["-ss", String(at)] : []
  ffmpeg([
    ...seek,
    "-i",
    src,
    ...["-frames:v", "1", "-vf", ["format=yuv420p", ...scale].join(",")],
    ...["-c:v", "libwebp", "-preset", "photo", "-q:v", "86", `${base}.webp`],
  ])
  ffmpeg([
    ...seek,
    "-i",
    src,
    ...["-frames:v", "1", "-vf", [...scale, "format=yuv420p10le"].join(",")],
    ...["-c:v", "libaom-av1", "-still-picture", "1", "-crf", "24", "-b:v", "0"],
    ...["-cpu-used", "4", `${base}.avif`],
  ])
}
