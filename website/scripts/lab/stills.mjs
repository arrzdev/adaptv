//Still compositions for /lab/visuals: real screenshots of the playground app, set in
//device frames with perspective, light and the rendered backdrops from art.mjs.
//
//  TMPDIR=/tmp/vis node scripts/lab/stills.mjs [name ...]
//
//Needs the playground up (PLAYGROUND_URL, see footage.mjs) and art.mjs run first (it reads
//the aurora and mesh PNGs from WORK).

import { existsSync } from "node:fs"
import { join } from "node:path"
import { IPHONE, launch, OUT, poster, renderHtml, WORK } from "./lib.mjs"
import { browser, dataUrl, page, phone } from "./plates.mjs"

const PLAYGROUND = process.env.PLAYGROUND_URL ?? "http://localhost:47831"
const STILLS = join(OUT, "stills")

const TASKS = [
  ["Book the dentist", "High"],
  ["Water the monstera", "Low"],
  ["Reply to the landlord", "Medium"],
  ["Renew passport", "Urgent"],
  ["Pick up the film rolls", "Medium"],
]

/** Screenshots of the playground, each with the page's background colour. */
async function shoot() {
  const shots = {}
  const b = await launch({ dpr: 3 })
  const take = async (name, { viewport, dpr, mobile }, go) => {
    const ctx = await b.newContext({
      viewport,
      deviceScaleFactor: dpr,
      isMobile: mobile,
      hasTouch: mobile,
      colorScheme: "dark",
    })
    const p = await ctx.newPage()
    await p.goto(`${PLAYGROUND}/`, { waitUntil: "networkidle" })
    await p.waitForTimeout(600)
    for (const [text, priority] of TASKS) {
      await p.getByRole("button", { name: "Create task" }).click()
      await p.getByRole("textbox", { name: "Task description" }).fill(text)
      await p.getByRole("button", { name: priority, exact: true }).click()
      await p.getByRole("button", { name: "Add task" }).click()
      await p.waitForTimeout(500)
    }
    if (go) await go(p)
    await p.waitForTimeout(900)
    const file = join(WORK, `shot-${name}.png`)
    await p.screenshot({ path: file })
    const bg = await p.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    )
    shots[name] = { file, bg }
    await ctx.close()
  }
  const PHONE = { ...IPHONE, dpr: 3 }
  await take("desktop", { viewport: { width: 1200, height: 760 }, dpr: 2 })
  await take("phone", PHONE)
  await take("sheet", PHONE, async (p) => {
    await p.getByRole("button", { name: "Create task" }).click()
    await p.waitForTimeout(700)
    const field = p.getByRole("textbox", { name: "Task description" })
    await field.click()
    await field.pressSequentially("Call the plumber", { delay: 20 })
  })
  await take("lab", PHONE, async (p) => {
    await p.goto(`${PLAYGROUND}/lab`, { waitUntil: "networkidle" })
    await p.evaluate(() => {
      const s = [...document.querySelectorAll("*")].find(
        (e) =>
          e.scrollHeight > e.clientHeight + 200 &&
          getComputedStyle(e).overflowY !== "visible",
      )
      if (s) s.scrollTop = 520
    })
  })
  await b.close()
  return shots
}

/** A phone screen: the screenshot under a status bar of the page's own colour. */
const phoneScreen = ({ file, bg }) =>
  `<div style="position:absolute;inset:0;background:${bg};padding:${(59 / 852) * 100}% 0 0"><img src="${dataUrl(file)}" style="display:block;width:100%"></div>`

const img = ({ file }) =>
  `<img src="${dataUrl(file)}" style="display:block;width:100%;height:100%;object-fit:cover;object-position:top">`

const backdrop = (name, fallback) => {
  const png = join(WORK, `still-${name}.png`)
  return existsSync(png)
    ? `${fallback} url(${dataUrl(png)}) center/cover`
    : fallback
}

async function out(name, html, size) {
  const png = join(WORK, `compo-${name}.png`)
  await renderHtml(html, { ...size, out: png, dpr: 1 })
  poster(png, join(STILLS, name))
  console.log(`  still ${name}`)
}

const JOBS = {
  //hero C: the app on desktop and phone, turned in space, over the rendered aurora
  async hero(s) {
    const size = { width: 2400, height: 1350 }
    const html = page(
      `<div style="position:absolute;inset:0;perspective:2600px;perspective-origin:50% 30%">
        ${browser({
          x: 300,
          y: 300,
          w: 1500,
          h: 950,
          url: "chopchop.local",
          content: img(s.desktop),
          style:
            "transform:rotateY(16deg) rotateX(7deg) rotateZ(-1deg);transform-origin:70% 50%;box-shadow:0 120px 200px -60px rgba(0,0,0,.9),0 0 0 1px #2a2a31,0 0 120px -20px rgba(91,108,255,.35)",
        })}
        ${phone({
          x: 1640,
          y: 250,
          w: 430,
          content: phoneScreen(s.phone),
          style:
            "transform:rotateY(-10deg) rotateX(5deg) translateZ(160px);box-shadow:0 120px 160px -40px rgba(0,0,0,.85),0 0 0 1px rgba(255,255,255,.1),0 0 140px -30px rgba(182,92,255,.45)",
        })}
      </div>
      <div style="position:absolute;inset:auto 0 0 0;height:260px;background:linear-gradient(to bottom,transparent,#08080a)"></div>`,
      { background: backdrop("aurora", "#08080a") },
    )
    await out("hero-3d", html, size)
  },
  //keyboard B: a real sheet with its field focused, riding on a drawn keyboard
  async keyboard(s) {
    const size = { width: 1600, height: 1250 }
    const keys = (row, inset = 0) =>
      `<div style="display:flex;gap:9px;justify-content:center;margin:0 ${inset}px 12px">${[
        ...row,
      ]
        .map(
          (k) =>
            `<span style="flex:1;max-width:48px;height:58px;border-radius:9px;background:#5a5a60;color:#fff;font:400 26px 'Geist';display:grid;place-items:center;box-shadow:0 1.5px 0 #1b1b1f">${k}</span>`,
        )
        .join("")}</div>`
    const keyboard = `<div style="position:absolute;left:0;right:0;bottom:0;height:43%;background:#2b2b30;padding:14px 6px 0;border-top:1px solid #3a3a40">
      ${keys("qwertyuiop")}${keys("asdfghjkl", 26)}${keys("zxcvbnm", 74)}
      <div style="display:flex;gap:9px;margin:0 8px"><span style="width:120px;height:58px;border-radius:9px;background:#3d3d42"></span><span style="flex:1;height:58px;border-radius:9px;background:#5a5a60;color:#fff;font:400 22px Geist;display:grid;place-items:center">space</span><span style="width:120px;height:58px;border-radius:9px;background:#8b95ff;color:#08080a;font:500 22px Geist;display:grid;place-items:center">return</span></div></div>`
    //the sheet from its top edge (30 % down the screenshot) placed 13 % down the screen;
    //the keyboard covers its lower half, as the real one does
    const sheet = `<div style="position:absolute;inset:0;background:${s.sheet.bg};overflow:hidden">
      <img src="${dataUrl(s.sheet.file)}" style="position:absolute;left:0;width:100%;top:-13.7%;display:block"></div>`
    const html = page(
      `<div style="position:absolute;left:50%;top:52%;width:900px;height:900px;transform:translate(-50%,-50%);background:radial-gradient(closest-side,rgba(91,108,255,.38),rgba(182,92,255,.12) 60%,transparent)"></div>
      ${phone({ x: 560, y: 70, w: 480, content: sheet + keyboard })}
      <div style="position:absolute;left:1080px;top:${70 + 480 * (852 / 393) * 0.57}px;width:420px;border-top:1.5px dashed #8b95ff;opacity:.8"></div>
      <div style="position:absolute;left:1100px;top:${70 + 480 * (852 / 393) * 0.57 + 14}px;color:#a3abff;font:500 22px 'Geist Mono'">keyboard top</div>`,
      { background: "#141418" },
    )
    await out("keyboard-compo", html, size)
  },
  //safe areas B: the insets the framework owns, lit up on a real screen
  async safe(s) {
    const size = { width: 1600, height: 1250 }
    const w = 480
    const H = w * (852 / 393)
    const band = (top, h) =>
      `<div style="position:absolute;left:0;right:0;top:${top}px;height:${h}px;background:repeating-linear-gradient(135deg,rgba(139,149,255,.34) 0 8px,rgba(139,149,255,.14) 8px 16px);border-${top === 0 ? "bottom" : "top"}:2px solid #8b95ff"></div>`
    const top = (59 / 852) * H
    const bottom = (34 / 852) * H
    const html = page(
      `${phone({
        x: 560,
        y: 70,
        w,
        content: `${phoneScreen(s.lab)}<div style="position:absolute;inset:0">${band(0, top)}${band(H - bottom, bottom)}</div>`,
      })}
      <div style="position:absolute;left:${560 + w * 1.054 + 44}px;top:${70 + w * 0.03 + top / 2 - 14}px;color:#c4c9ff;font:500 24px 'Geist Mono'">--adaptv-inset-top</div>
      <div style="position:absolute;left:${560 + w * 1.054 + 8}px;top:${70 + w * 0.03 + top / 2}px;width:28px;border-top:1.5px solid #8b95ff"></div>
      <div style="position:absolute;left:${560 + w * 1.054 + 44}px;top:${70 + w * 0.03 + H - bottom / 2 - 14}px;color:#c4c9ff;font:500 24px 'Geist Mono'">--adaptv-inset-bottom</div>
      <div style="position:absolute;left:${560 + w * 1.054 + 8}px;top:${70 + w * 0.03 + H - bottom / 2}px;width:28px;border-top:1.5px solid #8b95ff"></div>`,
      { background: backdrop("mesh", "#141418") },
    )
    await out("safe-compo", html, size)
  },
  //build guard B: the file and the refusal as two panes in space
  async guard() {
    const size = { width: 2000, height: 1250 }
    const mono = "font-family:'Geist Mono',ui-monospace,monospace"
    const html = page(
      `<div style="position:absolute;inset:0;perspective:2200px">
        <div style="position:absolute;left:240px;top:170px;width:1100px;height:520px;border-radius:22px;background:#0b0b0e;box-shadow:0 0 0 1px #2a2a31,0 80px 140px -40px rgba(0,0,0,.9);transform:rotateY(14deg) rotateX(6deg);${mono};font-size:28px;line-height:48px;color:#e4e4ea;padding:40px 48px">
          <div style="color:#80808b;font-size:20px;margin-bottom:22px">src/data/session.ts</div>
          <div><span style="color:#a5aefb">import</span> { createServerFn } <span style="color:#a5aefb">from</span> <span style="color:#8fd6a8;text-decoration:underline wavy #ff7a8e;text-underline-offset:9px;text-decoration-thickness:2px">"@tanstack/react-start"</span></div>
          <div>&nbsp;</div>
          <div><span style="color:#a5aefb">export const</span> getSession = <span style="color:#f2c78a">createServerFn</span>()…</div>
        </div>
        <div style="position:absolute;left:760px;top:600px;width:1080px;border-radius:22px;background:#160b0f;box-shadow:0 0 0 1.5px rgba(255,122,142,.55),0 80px 140px -30px rgba(0,0,0,.9),0 0 160px -30px rgba(255,106,154,.45);transform:rotateY(-8deg) rotateX(4deg) translateZ(120px);${mono};font-size:23px;line-height:36px;color:#e8d5da;padding:34px 42px">
          <div style="color:#ff7a8e;font-weight:500">Build failed with 1 error:</div>
          <div style="margin-top:10px">"@tanstack/react-start" is server-only and cannot be imported from application source.</div>
          <div style="color:#a3a3ad;margin-top:10px">Move the logic to your API and call it over the network, or use a route \`loader\`.</div>
        </div>
      </div>`,
      { background: backdrop("mesh", "#141418") },
    )
    await out("guard-3d", html, size)
  },
}

const wanted = process.argv.slice(2)
const shots = await shoot()
for (const [name, job] of Object.entries(JOBS))
  if (wanted.length === 0 || wanted.includes(name)) await job(shots)
