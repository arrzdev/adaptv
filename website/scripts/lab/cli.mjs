//The build guard, replayed: an editor with a file that imports a server-only API, and the
//build refusing it, in a terminal. Rendered frame by frame (draw(t)), so it is the same
//on any machine.
//
//  TMPDIR=/tmp/vis node scripts/lab/cli.mjs
//
//The terminal text is the build's real output, captured on 2026-10-18 by adding
//src/data/session.ts (below) to this website and running `vite build` (the build that
//`adaptv build web` runs; the CLI itself shows only "vite build exited with code 1").
//Only the absolute path is shortened to the project's.

import { existsSync } from "node:fs"
import { join } from "node:path"
import { encode, OUT, renderFrames, WORK } from "./lib.mjs"
import { dataUrl } from "./plates.mjs"

const CODE = [
  'import { createServerFn } from "@tanstack/react-start"',
  "",
  "export const getSession = createServerFn().handler(async () => {",
  '  return { user: "me" }',
  "})",
]

const OUTPUT = [
  ["err", "error during build:"],
  ["", "Build failed with 1 error:"],
  ["", ""],
  ["dim", "[plugin adaptv:ban-server-apis] src/data/session.ts"],
  [
    "err",
    'RolldownError: "@tanstack/react-start" is server-only and cannot be imported from application source.',
  ],
  [
    "",
    "It needs a server to run, and the native app has none — the app is a folder of files on the device, so this would work in dev and in an SSR deploy, then fail on iOS and Android.",
  ],
  [
    "",
    "Move the logic to your API and call it over the network, or use a route `loader`, which is isomorphic and fully supported.",
  ],
]

const esc = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

/** Tiny highlighter for the five lines above. */
const hl = (line) =>
  esc(line)
    .replace(/(")([^"]*)(")/g, '<i class="s">"$2"</i>')
    .replace(
      /\b(import|from|export|const|async|return)\b/g,
      '<i class="k">$1</i>',
    )
    .replace(/\b(createServerFn|handler)\b/g, '<i class="f">$1</i>')

function html({ width, height, background }) {
  return `<!doctype html><html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@500;600&family=Geist+Mono:wght@400;500&display=block">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:${width}px;height:${height}px;background:${background};font-family:"Geist Mono",ui-monospace,monospace;-webkit-font-smoothing:antialiased;overflow:hidden;position:relative}
.win{position:absolute;left:70px;top:60px;right:70px;bottom:60px;border-radius:16px;overflow:hidden;background:#0b0b0e;
  box-shadow:0 50px 100px -30px rgba(0,0,0,.9),0 0 0 1px #2a2a31}
.bar{height:44px;display:flex;align-items:center;gap:8px;padding:0 18px;background:#0e0e11;border-bottom:1px solid #1c1c21}
.bar i{width:12px;height:12px;border-radius:50%;display:block}
.tab{margin-left:24px;height:44px;display:flex;align-items:center;padding:0 16px;color:#e4e4ea;font:500 14px "Geist Mono";border-bottom:1.5px solid #8b95ff}
.code{padding:22px 0 0;font-size:19px;line-height:31px;color:#e4e4ea;height:228px}
.ln{display:flex;white-space:pre}
.ln b{width:64px;text-align:right;padding-right:22px;color:#4a4a55;font-weight:400}
.k{color:#a5aefb;font-style:normal}.s{color:#8fd6a8;font-style:normal}.f{color:#f2c78a;font-style:normal}
.squig{text-decoration:underline wavy #ff7a8e;text-decoration-thickness:1.5px;text-underline-offset:5px}
.caret{display:inline-block;width:10px;height:22px;background:#8b95ff;vertical-align:-4px}
.term{position:absolute;left:0;right:0;bottom:0;top:292px;border-top:1px solid #1c1c21;background:#08080a;padding:18px 28px;font-size:17px;line-height:27px;color:#d4d4dc}
.term .t{color:#80808b;font:500 12px "Geist";letter-spacing:.08em;text-transform:uppercase;margin-bottom:10px}
.term p{white-space:pre-wrap;min-height:27px}
.p{color:#8b95ff}.err{color:#ff7a8e}.dim{color:#80808b}
</style></head><body>
<div class="win">
  <div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span class="tab">src/data/session.ts</span></div>
  <div class="code" id="code"></div>
  <div class="term"><div class="t">Terminal</div><div id="term"></div></div>
</div>
<script>{
const CODE = ${JSON.stringify(CODE.map(hl))}
const RAW = ${JSON.stringify(CODE)}
const OUT = ${JSON.stringify(OUTPUT.map(([c, t]) => [c, esc(t)]))}
const CMD = "pnpm exec vite build"
const T = 10
const code = document.getElementById("code"), term = document.getElementById("term")
//the code types itself in 0.3 – 2.6 s, the command at 3.0 – 3.6 s, the build fails at 4.4 s
window.draw = (p) => {
  const s = p * T
  const total = RAW.join("").length
  let left = Math.floor(Math.max(0, Math.min(1, (s - 0.3) / 2.3)) * total)
  let caretShown = false
  code.innerHTML = RAW.map((raw, i) => {
    const take = Math.min(raw.length, left)
    left -= take
    const full = take === raw.length
    const text = full ? CODE[i] : raw.slice(0, take).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    let caret = ""
    if (!full && !caretShown) { caret = '<span class="caret"></span>'; caretShown = true }
    const bad = s > 4.6 && i === 0 ? ' class="squig"' : ""
    return '<div class="ln"><b>' + (i + 1) + '</b><span' + bad + '>' + text + caret + '</span></div>'
  }).join("")
  const typed = Math.max(0, Math.min(CMD.length, Math.floor(((s - 3.0) / 0.6) * CMD.length)))
  let lines = ['<p><span class="p">~/website $</span> ' + CMD.slice(0, typed) + (s > 2.8 && s < 4.0 && Math.floor(s * 2) % 2 === 0 ? '<span class="caret" style="width:9px;height:18px"></span>' : "") + '</p>']
  if (s > 4.4) {
    const n = Math.min(OUT.length, Math.floor((s - 4.4) / 0.12) + 1)
    lines = lines.concat(OUT.slice(0, n).map(([c, t]) => '<p class="' + c + '">' + t + '</p>'))
  }
  if (s > 6.2) lines.push('<p><span class="p">~/website $</span> </p>')
  term.innerHTML = lines.join("")
}
}</script></body></html>`
}

const meshPng = join(WORK, "still-mesh.png")
const background = existsSync(meshPng)
  ? `#141418 url(${dataUrl(meshPng)}) center/cover`
  : "#141418"
const size = { width: 1400, height: 900 }
const master = await renderFrames("cli", html({ ...size, background }), {
  ...size,
  seconds: 10,
})
encode(master, join(OUT, "footage", "guard-cli"), { kbps: 700, posterAt: 8 })
