//Device frames for recorded footage, drawn in HTML and rendered by Chrome, then filled with
//video by ffmpeg. A plate is one page with any number of `.screen` boxes: Chrome renders it
//twice (once whole, with the screens black; once with only the `.over` parts, such as the
//Dynamic Island, on transparent) and reports each screen's box. ffmpeg scales a clip into
//each box, rounds its corners with a mask, and lays the `.over` layer on top.
//
//The frames are generic on purpose, like components/frames.tsx: a rounded slab and a
//camera cut-out, no one's artwork.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ffmpeg, fresh, probe, renderHtml, WORK } from "./lib.mjs"

export const dataUrl = (file, type = "image/png") =>
  `data:${type};base64,${readFileSync(file).toString("base64")}`

const BASE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden}
body{font-family:"Geist","Inter",ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased;position:relative}
.abs{position:absolute}
.screen{background:#000;position:absolute;overflow:hidden}
body.fg{background:transparent!important}
body.fg *{visibility:hidden;background-image:none}
body.fg .over,body.fg .over *{visibility:visible}
/* an iPhone-like slab: titanium edge, black bezel, screen, island */
.phone{position:absolute;border-radius:calc(var(--w)*0.177);padding:calc(var(--w)*0.027);
  background:linear-gradient(145deg,#4a4a52,#1c1c21 30%,#2e2e35 70%,#55555e);
  box-shadow:0 calc(var(--w)*0.12) calc(var(--w)*0.3) calc(var(--w)*-0.06) rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.08),inset 0 0 0 1.5px rgba(255,255,255,.12)}
.phone .bezel{position:relative;width:100%;height:100%;border-radius:calc(var(--w)*0.152);background:#000;overflow:hidden}
.phone .screen{inset:0;border-radius:calc(var(--w)*0.15)}
.phone .island{position:absolute;top:calc(var(--w)*0.03);left:50%;width:32%;height:calc(var(--w)*0.093);transform:translateX(-50%);border-radius:999px;background:#000}
.phone.android{border-radius:calc(var(--w)*0.13);padding:calc(var(--w)*0.023)}
.phone.android .bezel{border-radius:calc(var(--w)*0.108)}
.phone.android .screen{border-radius:calc(var(--w)*0.105)}
.phone.android .island{width:calc(var(--w)*0.034);height:calc(var(--w)*0.034);top:calc(var(--w)*0.03)}
/* a desktop browser window */
.window{position:absolute;border-radius:14px;overflow:hidden;background:#0e0e11;
  box-shadow:0 40px 90px -30px rgba(0,0,0,.85),0 0 0 1px #2a2a31}
.window .bar{height:40px;display:flex;align-items:center;gap:12px;padding:0 16px;background:#0b0b0e;border-bottom:1px solid #1c1c21}
.window .lights{display:flex;gap:7px;width:60px}
.window .lights i{width:11px;height:11px;border-radius:50%;display:block}
.window .url{flex:1;max-width:340px;margin:0 auto;height:24px;border-radius:7px;background:#16161b;color:#80808b;
  font:500 12px "Geist Mono",ui-monospace,monospace;display:flex;align-items:center;justify-content:center;gap:6px}
.window .screen{position:absolute;left:0;right:0;bottom:0;top:40px}
.window.app .bar{height:32px}
.window.app .screen{top:32px}
.window .title{flex:1;text-align:center;color:#a3a3ad;font:500 12.5px "Geist",ui-sans-serif;padding-right:60px}
.status{position:absolute;left:0;right:0;top:0;height:calc(var(--w)*0.14);display:flex;align-items:center;justify-content:space-between;
  padding:calc(var(--w)*0.02) calc(var(--w)*0.085) 0 calc(var(--w)*0.1);color:#fff;font:600 calc(var(--w)*0.04) "Geist",ui-sans-serif,system-ui}
.status svg{height:calc(var(--w)*0.03);width:auto;margin-left:calc(var(--w)*0.012)}
.homebar{position:absolute;left:50%;bottom:calc(var(--w)*0.022);width:36%;height:calc(var(--w)*0.013);transform:translateX(-50%);border-radius:9px;background:rgba(255,255,255,.85)}
.android .status{height:calc(var(--w)*0.08);padding:calc(var(--w)*0.012) calc(var(--w)*0.07) 0;font-size:calc(var(--w)*0.034)}
.android .homebar{width:28%;height:calc(var(--w)*0.01);bottom:calc(var(--w)*0.018)}
.cap{position:absolute;color:#80808b;font:500 15px "Geist",ui-sans-serif,system-ui;text-align:center}
`

const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@500&display=block">`

export function page(body, { background = "#141418", css = "" } = {}) {
  return `<!doctype html><html><head>${FONTS}<style>${BASE_CSS}${css}</style></head>
<body style="background:${background}">${body}</body></html>`
}

const ICONS = `<span style="display:flex;align-items:center"><svg viewBox="0 0 18 12"><g fill="#fff"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></g></svg><svg viewBox="0 0 16 12"><path fill="#fff" d="M8 2.2c2.3 0 4.4.9 6 2.4l1.3-1.4A10.5 10.5 0 0 0 8 .3 10.5 10.5 0 0 0 .7 3.2L2 4.6a8.6 8.6 0 0 1 6-2.4Zm0 3.8c1.3 0 2.5.5 3.4 1.3l1.3-1.4A6.8 6.8 0 0 0 8 4a6.8 6.8 0 0 0-4.7 1.9l1.3 1.4C5.5 6.5 6.7 6 8 6Zm0 3.7c.5 0 1 .2 1.3.5L8 11.7 6.7 10.2c.3-.3.8-.5 1.3-.5Z"/></svg><svg viewBox="0 0 27 12"><rect x=".5" y=".5" width="23" height="11" rx="3.5" fill="none" stroke="rgba(255,255,255,.5)"/><rect x="2" y="2" width="17" height="8" rx="2" fill="#fff"/><rect x="24.5" y="4" width="1.8" height="4" rx=".9" fill="rgba(255,255,255,.5)"/></svg></span>`

/**
 * An iPhone (or an Android phone) whose screen is `w` px wide, 393 x 852 in shape. The
 * clip fills the whole screen; composite() grows it into the status bar and the home
 * indicator (`bars`), and the time, the icons and the island are drawn over it.
 */
export function phone({
  x,
  y,
  w,
  android = false,
  aspect = 852 / 393,
  content = "",
  style = "",
}) {
  const outerW = w * 1.054
  return `<div class="phone${android ? " android" : ""}" style="--w:${outerW}px;left:${x}px;top:${y}px;width:${outerW}px;height:${w * aspect + outerW * 0.054}px;${style}">
  <div class="bezel"><div class="screen">${content}</div><div class="island over"></div>
  <div class="status over"><span>9:41</span>${ICONS}</div><div class="homebar over"></div></div></div>`
}

/** The status bar and home indicator an iPhone recording (393 x 759 pt) grows into. */
export const IPHONE_BARS = [59 / 759, 34 / 759]

/** A browser window; `app` drops the address bar, as an installed PWA's window does. */
export function browser({
  x,
  y,
  w,
  h,
  url = "localhost",
  app = false,
  content = "",
  style = "",
}) {
  const lights = `<div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>`
  //an installed PWA's window: a title bar with the app's name, no address bar
  const bar = app
    ? `<div class="bar">${lights}<div class="title">${url}</div></div>`
    : `<div class="bar">${lights}<div class="url">&#128274;&#xFE0E; ${url}</div><div style="width:60px"></div></div>`
  return `<div class="window${app ? " app" : ""}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;${style}">${bar}<div class="screen">${content}</div></div>`
}

export const caption = (text, { x, y, w }) =>
  `<div class="cap" style="left:${x}px;top:${y}px;width:${w}px">${text}</div>`

/**
 * Fills a plate's screens with clips. `clips[i]` goes in the i-th `.screen` in document
 * order: `{ src, start = 0, crop, bars }`, with `crop` = `w:h:x:y` in the source's pixels
 * and `bars` = `[top, bottom]` as fractions of its height: the clip's top and bottom rows
 * are stretched that much further, so the status bar is the page's own colour (and dims
 * with it when a sheet opens), as an installed app pads under the bars.
 * Writes a near-lossless master MP4 of `seconds` and returns its path; encode() makes
 * the deliverables from it.
 */
export async function composite(name, html, { width, height, clips, seconds }) {
  const dir = fresh(join(WORK, "plates", name))
  const bg = join(dir, "bg.png")
  const fg = join(dir, "fg.png")
  const boxes = await renderHtml(html, {
    width,
    height,
    out: bg,
    rects: [".screen"],
  })
  await renderHtml(html.replace("<body ", '<body class="fg" '), {
    width,
    height,
    out: fg,
    transparent: true,
  })
  const screens = boxes[".screen"]
  if (screens.length !== clips.length)
    throw new Error(`${name}: ${screens.length} screens, ${clips.length} clips`)
  const masks = []
  for (const [i, s] of screens.entries()) {
    const m = join(dir, `mask${i}.png`)
    await renderHtml(
      `<body style="margin:0;background:#000"><div style="width:${s.w}px;height:${s.h}px;border-radius:${s.radius}px;background:#fff"></div></body>`,
      { width: s.w, height: s.h, out: m },
    )
    masks.push(m)
  }
  const inputs = ["-loop", "1", "-i", bg]
  for (const c of clips) {
    if (c.start) inputs.push("-ss", String(c.start))
    inputs.push("-stream_loop", "-1", "-i", c.src)
  }
  for (const m of masks) inputs.push("-loop", "1", "-i", m)
  inputs.push("-loop", "1", "-i", fg)
  const n = clips.length
  const chains = []
  let base = "[0:v]"
  screens.forEach((s, i) => {
    const crop = clips[i].crop ? `crop=${clips[i].crop},` : ""
    let src = `[${i + 1}:v]${crop}`
    if (clips[i].bars) {
      const { h } = probe(clips[i].src)
      const [top, bottom] = clips[i].bars.map(
        (f) => 2 * Math.round((f * h) / 2),
      )
      chains.push(
        `${src}split=3[c${i}][t${i}][u${i}]`,
        `[t${i}]crop=iw:2:0:0,scale=iw:${top}[tt${i}]`,
        `[u${i}]crop=iw:2:0:ih-2,scale=iw:${bottom}[uu${i}]`,
        `[tt${i}][c${i}][uu${i}]vstack=3[s${i}]`,
      )
      src = `[s${i}]`
    }
    chains.push(
      `${src}scale=${s.w}:${s.h}:flags=lanczos,setsar=1,format=rgba[v${i}]`,
      `[${1 + n + i}:v]format=gray[m${i}]`,
      `[v${i}][m${i}]alphamerge[a${i}]`,
      `${base}[a${i}]overlay=${s.x}:${s.y}:shortest=0[b${i}]`,
    )
    base = `[b${i}]`
  })
  chains.push(`${base}[${1 + 2 * n}:v]overlay=0:0,fps=30,format=yuv420p[out]`)
  const master = join(WORK, `plate-${name}.mp4`)
  ffmpeg([
    ...inputs,
    ...["-filter_complex", chains.join(";"), "-map", "[out]"],
    ...["-t", String(seconds), "-c:v", "libx264", "-crf", "12"],
    ...["-preset", "fast", master],
  ])
  console.log(`  plate ${name}: ${n} screen(s), ${seconds} s`)
  return master
}
