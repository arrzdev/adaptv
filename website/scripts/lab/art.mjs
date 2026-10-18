//Generated art for /lab/visuals, rendered frame by frame in headless Chrome: WebGL shaders
//and canvas light trails in the site's colours, written to public/lab/art/.
//
//  TMPDIR=/tmp/vis node scripts/lab/art.mjs [name ...]
//
//Every loop is periodic in its phase `t` (0 → 1), so the last frame meets the first and a
//`loop` video never jumps. Time is stepped by the script, never read from a clock, so a
//slow software GPU renders the same frames as a fast one.

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { encode, launch, OUT, poster, renderFrames, WORK } from "./lib.mjs"

const ART = join(OUT, "art")

//the hero's light (.aurora in main.css) and the brand indigo, over the dark page
export const PALETTE = {
  bg: "#08080a",
  card: "#141418",
  indigo: "#5b6cff",
  brand: "#8b95ff",
  violet: "#b65cff",
  pink: "#ff6a9a",
  amber: "#ffb86a",
}

const GLSL_NOISE = `
precision highp float;
uniform vec2 r;
uniform float t;
uniform float seed;
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21) + seed); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++){ v += a*noise(p); p = m*p; a *= 0.5; }
  return v;
}
vec3 hex(float r, float g, float b){ return vec3(r, g, b)/255.0; }
`

/** Curtains of light that drift and fold: the hero's aurora, alive. */
const AURORA = `${GLSL_NOISE}
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5*r)/r.y;
  float a = 6.2831853*t;
  vec2 o = vec2(cos(a), sin(a));
  vec2 q = vec2(fbm(p*1.3 + 0.35*o), fbm(p*1.3 + vec2(5.2, 1.3) - 0.35*o));
  vec2 w = vec2(fbm(p*1.5 + 2.2*q + vec2(1.7, 9.2) + 0.25*o.yx),
                fbm(p*1.5 + 2.2*q + vec2(8.3, 2.8) - 0.25*o.yx));
  float f = fbm(vec2(p.x*1.1, p.y*0.45) + 2.4*w);
  vec3 indigo = hex(91.0, 108.0, 255.0), violet = hex(182.0, 92.0, 255.0);
  vec3 pink = hex(255.0, 106.0, 154.0), amber = hex(255.0, 184.0, 106.0);
  vec3 c = mix(indigo, violet, smoothstep(0.2, 0.8, w.x));
  c = mix(c, pink, smoothstep(0.55, 0.95, w.y)*0.85);
  c = mix(c, amber, smoothstep(0.78, 1.0, q.x)*0.5);
  float light = smoothstep(0.32, 0.95, f);
  //a horizon: the light gathers in the upper middle and falls off to the edges
  float y = gl_FragCoord.y/r.y;
  float body = smoothstep(0.0, 0.55, y)*smoothstep(1.05, 0.55, y);
  float side = smoothstep(0.0, 0.25, gl_FragCoord.x/r.x)*smoothstep(1.0, 0.75, gl_FragCoord.x/r.x);
  vec3 bg = hex(8.0, 8.0, 10.0);
  vec3 col = bg + c*light*body*mix(0.55, 1.0, side)*1.25;
  gl_FragColor = vec4(col, 1.0);
}`

/** A slow mesh of soft colour pools: a backdrop for a card, quieter than the aurora. */
const MESH = `${GLSL_NOISE}
void main(){
  vec2 uv = gl_FragCoord.xy/r;
  vec2 p = (gl_FragCoord.xy - 0.5*r)/r.y;
  float a = 6.2831853*t;
  vec2 o = 0.18*vec2(cos(a), sin(a));
  vec3 base = hex(20.0, 20.0, 24.0);
  vec3 col = base;
  col += hex(91.0, 108.0, 255.0)*0.55*smoothstep(0.75, 0.0, length(p - vec2(-0.55, 0.32) - o));
  col += hex(182.0, 92.0, 255.0)*0.42*smoothstep(0.7, 0.0, length(p - vec2(0.15, 0.48) + o.yx));
  col += hex(255.0, 106.0, 154.0)*0.32*smoothstep(0.6, 0.0, length(p - vec2(0.7, 0.1) - o.yx));
  float n = fbm(p*2.2 + 3.0*o);
  col *= 0.75 + 0.5*n;
  col = mix(base, col, smoothstep(-0.2, 0.7, uv.y));
  gl_FragColor = vec4(col, 1.0);
}`

/** Fine grain over a still, so a wide gradient does not band. */
const GRAIN = `${GLSL_NOISE}
uniform sampler2D img;
void main(){
  vec2 uv = gl_FragCoord.xy/r;
  vec3 c = texture2D(img, vec2(uv.x, 1.0 - uv.y)).rgb;
  float g = hash(gl_FragCoord.xy) - 0.5;
  gl_FragColor = vec4(c + g*0.035, 1.0);
}`

function shaderPage(frag, { width, height, seed = 0.37 }) {
  return `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="${width}" height="${height}"></canvas>
<script>{
const c = document.getElementById("c")
const gl = c.getContext("webgl", { preserveDrawingBuffer: true })
const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s }
const prog = gl.createProgram()
gl.attachShader(prog, sh(gl.VERTEX_SHADER, "attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }"))
gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, ${JSON.stringify(frag)}))
gl.linkProgram(prog); gl.useProgram(prog)
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf)
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW)
const loc = gl.getAttribLocation(prog, "a"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
gl.uniform2f(gl.getUniformLocation(prog, "r"), c.width, c.height)
gl.uniform1f(gl.getUniformLocation(prog, "seed"), ${seed})
window.draw = (t) => { gl.uniform1f(gl.getUniformLocation(prog, "t"), t); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.finish() }
window.grainOver = (dataUrl) => new Promise((res) => {
  const im = new Image(); im.onload = () => {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, im)
    res()
  }; im.src = dataUrl
})
}</script></body></html>`
}

/*
 * Light trails on a 2D canvas, additive. Each trail is a cubic curve with a faint rail and
 * a bright comet that runs along it once per loop, at its own phase.
 */
function trailsPage({ width, height, mode, count, seed }) {
  return `<!doctype html><html><body style="margin:0;background:${PALETTE.card}">
<canvas id="c" width="${width}" height="${height}"></canvas>
<script>{
const W = ${width}, H = ${height}, MODE = ${JSON.stringify(mode)}
const c = document.getElementById("c"), g = c.getContext("2d")
let s = ${seed}
const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
const COLORS = ${JSON.stringify([PALETTE.indigo, PALETTE.brand, PALETTE.violet, PALETTE.pink])}
const curves = []
const sinks = MODE === "split"
  ? [0.14, 0.38, 0.62, 0.86].map((x) => [W * x, H * 0.84])
  : [[W * 0.5, H * 0.62]]
const core = MODE === "split" ? [W * 0.5, H * 0.16] : sinks[0]
for (let i = 0; i < ${count}; i++) {
  let a, b
  if (MODE === "split") {
    const k = i % 4
    a = [core[0] + (rnd() - 0.5) * W * 0.04, core[1]]
    b = [sinks[k][0] + (rnd() - 0.5) * W * 0.06, sinks[k][1]]
  } else {
    //from the three sides a gesture can come from: left edge, right edge, the top
    const side = i % 3
    a = side === 0 ? [-20, H * (0.1 + rnd() * 0.8)] : side === 1 ? [W + 20, H * (0.1 + rnd() * 0.8)] : [W * (0.1 + rnd() * 0.8), -20]
    b = [core[0] + (rnd() - 0.5) * 6, core[1] + (rnd() - 0.5) * 6]
  }
  const bend = (rnd() - 0.5) * 0.6
  const c1 = MODE === "split"
    ? [a[0] + (rnd() - 0.5) * W * 0.1, a[1] + H * (0.25 + rnd() * 0.15)]
    : [a[0] + (b[0] - a[0]) * 0.35 + W * bend * 0.3, a[1] + (b[1] - a[1]) * 0.1]
  const c2 = MODE === "split"
    ? [b[0] + (rnd() - 0.5) * W * 0.05, b[1] - H * (0.3 + rnd() * 0.12)]
    : [b[0] + (a[0] - b[0]) * 0.25, b[1] - H * (0.15 + rnd() * 0.1)]
  curves.push({ a, c1, c2, b, color: COLORS[i % COLORS.length], phase: rnd(), speed: 1 + Math.floor(rnd() * 2), width: 1 + rnd() * 1.6 })
}
const pt = (cv, u) => {
  const v = 1 - u
  return [
    v*v*v*cv.a[0] + 3*v*v*u*cv.c1[0] + 3*v*u*u*cv.c2[0] + u*u*u*cv.b[0],
    v*v*v*cv.a[1] + 3*v*v*u*cv.c1[1] + 3*v*u*u*cv.c2[1] + u*u*u*cv.b[1],
  ]
}
const glow = (x, y, r, color, alpha) => {
  const gr = g.createRadialGradient(x, y, 0, x, y, r)
  gr.addColorStop(0, color + Math.round(alpha * 255).toString(16).padStart(2, "0"))
  gr.addColorStop(1, color + "00")
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
}
window.draw = (t) => {
  g.globalCompositeOperation = "source-over"
  g.fillStyle = "${PALETTE.card}"; g.fillRect(0, 0, W, H)
  g.globalCompositeOperation = "lighter"
  g.lineCap = "round"
  for (const cv of curves) {
    g.strokeStyle = cv.color + "16"; g.lineWidth = cv.width
    g.beginPath(); g.moveTo(...cv.a); g.bezierCurveTo(...cv.c1, ...cv.c2, ...cv.b); g.stroke()
    const head = (cv.phase + t * cv.speed) % 1
    const len = 0.22
    const N = 40
    for (let j = 0; j < N; j++) {
      const u0 = head - (len * j) / N, u1 = head - (len * (j + 1)) / N
      if (u1 < 0) break
      const p0 = pt(cv, u0), p1 = pt(cv, u1)
      const fade = 1 - j / N
      g.strokeStyle = cv.color + Math.round(fade * fade * 230).toString(16).padStart(2, "0")
      g.lineWidth = cv.width * (1 + fade * 1.4)
      g.lineCap = "butt"
      g.beginPath(); g.moveTo(...p0); g.lineTo(...p1); g.stroke()
    }
    if (head > 0.02) { const h = pt(cv, head); glow(h[0], h[1], 10 + cv.width * 4, cv.color, 0.55) }
  }
  //where the light arrives: one owner, or four targets
  const pulse = 0.5 + 0.5 * Math.cos(t * Math.PI * 2 * 2)
  if (MODE === "split") {
    glow(core[0], core[1], 90, "${PALETTE.indigo}", 0.55)
    glow(core[0], core[1], 26, "#ffffff", 0.7)
    sinks.forEach(([x, y], i) => { glow(x, y, 70, COLORS[i], 0.28 + 0.12 * pulse); glow(x, y, 12, "#ffffff", 0.5) })
  } else {
    glow(core[0], core[1], 150, "${PALETTE.brand}", 0.32 + 0.12 * pulse)
    glow(core[0], core[1], 34, "#ffffff", 0.75)
  }
}
}</script></body></html>`
}

/** One frame of a shader, with grain on top, as a lossless PNG. */
async function renderStill(name, frag, { width, height, t = 0, seed }) {
  const browser = await launch()
  const page = await browser.newPage({ viewport: { width, height } })
  await page.setContent(shaderPage(frag, { width, height, seed }))
  await page.evaluate((x) => window.draw(x), t)
  const base = await page.evaluate(() =>
    document.getElementById("c").toDataURL("image/png"),
  )
  await page.setContent(shaderPage(GRAIN, { width, height, seed }))
  await page.evaluate((u) => window.grainOver(u), base)
  await page.evaluate(() => window.draw(0))
  const png = join(WORK, `still-${name}.png`)
  await page.locator("canvas").screenshot({ path: png })
  await browser.close()
  return png
}

const JOBS = {
  //hero backdrop: 10 s of drifting curtains, wide
  async aurora() {
    const size = { width: 1600, height: 900 }
    const m = await renderFrames("aurora", shaderPage(AURORA, size), {
      ...size,
      seconds: 10,
      fps: 24,
    })
    encode(m, join(ART, "aurora"), { kbps: 900, posterAt: 2 })
    //a grained still, for footage.mjs and stills.mjs to stand the devices on
    await renderStill("aurora", AURORA, { ...size, t: 0.08 })
  },
  //card backdrop: a quiet colour mesh, still only
  async mesh() {
    const still = await renderStill("mesh", MESH, {
      width: 1600,
      height: 1000,
      t: 0.2,
      seed: 0.61,
    })
    poster(still, join(ART, "mesh"))
  },
  //gestures: every touch source converging on one owner
  async converge() {
    const size = { width: 1200, height: 760 }
    const html = trailsPage({ ...size, mode: "converge", count: 54, seed: 7 })
    const m = await renderFrames("converge", html, { ...size, seconds: 6 })
    encode(m, join(ART, "trails-converge"), { kbps: 1100, posterAt: 1.5 })
  },
  //targets: one app splitting into four streams
  async split() {
    const size = { width: 1600, height: 760 }
    const html = trailsPage({ ...size, mode: "split", count: 64, seed: 11 })
    const m = await renderFrames("split", html, { ...size, seconds: 6 })
    encode(m, join(ART, "trails-split"), { kbps: 1100, posterAt: 1.5 })
  },
}

const wanted = process.argv.slice(2)
mkdirSync(ART, { recursive: true })
for (const [name, job] of Object.entries(JOBS))
  if (wanted.length === 0 || wanted.includes(name)) await job()
