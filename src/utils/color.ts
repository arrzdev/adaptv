/**
 * The minimum colour arithmetic the browser-chrome tint needs: read a CSS colour, lay one over
 * another, and walk between two of them.
 *
 * Input can arrive in any of the forms an engine hands back from `getComputedStyle` — including
 * `oklch()`/`oklab()`, which is what Tailwind v4's `/opacity` modifiers resolve to, and therefore
 * the *common* case rather than the exotic one. Output is always 8-bit sRGB, because the only
 * destination is a `theme-color` meta and that is all it can carry.
 *
 * ⚠︎ The compositing and mixing here work on **gamma-encoded sRGB**, deliberately, and that is not the space
 * `STYLING.md` reaches for elsewhere (OKLCH, via `color-mix()`). The difference matters because
 * these numbers are not chosen for perceptual evenness — they have to *match a pixel the browser
 * already painted*. A scrim laid over a page is composited source-over in the device's sRGB, so
 * computing the same result in OKLCH would produce a tint that is visibly not the colour on
 * screen. Use `color-mix()` at the use site for anything that is a design decision; use this only
 * where the answer is "what colour is that area, actually".
 */

/** 0–255 per channel. */
export type Rgb = { r: number; g: number; b: number }
/** {@link Rgb} plus alpha in `[0,1]`. */
export type Rgba = Rgb & { a: number }

const HEX = /^#([0-9a-f]{3,8})$/i
//`rgb(0, 0, 0)`, `rgba(0 0 0 / 40%)`, and every mix of the two syntaxes
const RGB_FN = /^rgba?\(([^)]*)\)$/i
//`oklch(0 0 0 / 0.65)` / `oklab(0 0 0 / 0.4)` — NOT an exotic case. Tailwind v4
//compiles every `/opacity` modifier to `color-mix()`, which an engine resolves to
//`oklab()`, so the drawer's own default scrim arrives in this form.
const OK_FN = /^(oklch|oklab)\(([^)]*)\)$/i

function channel(token: string): number | null {
  const text = token.trim()
  if (!text) return null
  const percent = text.endsWith("%")
  const value = Number.parseFloat(percent ? text.slice(0, -1) : text)
  if (!Number.isFinite(value)) return null
  return clamp255(percent ? (value / 100) * 255 : value)
}

function alphaChannel(token: string): number | null {
  const text = token.trim()
  if (!text) return null
  const percent = text.endsWith("%")
  const value = Number.parseFloat(percent ? text.slice(0, -1) : text)
  if (!Number.isFinite(value)) return null
  return Math.min(1, Math.max(0, percent ? value / 100 : value))
}

function clamp255(value: number) {
  return Math.min(255, Math.max(0, value))
}

function expandHex(digits: string): string | null {
  if (digits.length === 3 || digits.length === 4) {
    return digits
      .split("")
      .map((d) => d + d)
      .join("")
  }
  if (digits.length === 6 || digits.length === 8) return digits
  return null
}

/** `none` is a real keyword in the modern syntaxes and means "this channel, zeroed". */
function okNumber(token: string, percentScale: number): number | null {
  const text = token.trim().toLowerCase()
  if (!text || text === "none") return 0
  const percent = text.endsWith("%")
  const value = Number.parseFloat(percent ? text.slice(0, -1) : text)
  if (!Number.isFinite(value)) return null
  return percent ? (value / 100) * percentScale : value
}

function hueDegrees(token: string): number | null {
  const text = token.trim().toLowerCase()
  if (!text || text === "none") return 0
  const value = Number.parseFloat(text)
  if (!Number.isFinite(value)) return null
  if (text.endsWith("turn")) return value * 360
  if (text.endsWith("rad")) return (value * 180) / Math.PI
  if (text.endsWith("grad")) return value * 0.9
  return value
}

/** sRGB's transfer function — linear light to the gamma-encoded values a screen is addressed in. */
function encodeGamma(linear: number): number {
  const sign = linear < 0 ? -1 : 1
  const value = Math.abs(linear)
  const encoded =
    value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
  return clamp255(sign * encoded * 255)
}

/**
 * OKLab → sRGB, via Björn Ottosson's matrices.
 *
 * Out-of-gamut colours are clipped per channel rather than gamut-mapped: the destination is a
 * `theme-color` meta, which is 8-bit sRGB and nothing else, and a proper gamut map would be a
 * large amount of arithmetic to move a browser toolbar by less than it can display.
 * @see https://bottosson.github.io/posts/oklab/
 */
function oklabToRgb(L: number, a: number, b: number): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3

  return {
    r: encodeGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encodeGamma(
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    ),
    b: encodeGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

/**
 * Parse a hex, `rgb()`/`rgba()`, `oklab()` or `oklch()` colour. `null` for anything else — including the wide-gamut and
 * `oklch()` forms a modern engine can hand back from `getComputedStyle`.
 *
 * That `null` is the whole error contract, and callers are expected to do nothing rather than
 * guess: a tint that is merely *close* to the surface it is meant to continue reads worse than no
 * tint at all, because the seam is what the eye lands on.
 */
export function parseCssColor(value: string): Rgba | null {
  const text = value.trim()

  const hex = HEX.exec(text)
  if (hex) {
    const digits = expandHex(hex[1])
    if (!digits) return null
    const int = Number.parseInt(digits.slice(0, 6), 16)
    const a =
      digits.length === 8
        ? Number.parseInt(digits.slice(6, 8), 16) / 255
        : 1
    return {
      r: (int >> 16) & 255,
      g: (int >> 8) & 255,
      b: int & 255,
      a,
    }
  }

  const ok = OK_FN.exec(text)
  if (ok) return parseOkColor(ok[1].toLowerCase(), ok[2])

  const fn = RGB_FN.exec(text)
  if (!fn) return null
  const [rgbPart, alphaPart] = fn[1].split("/")
  const parts = rgbPart
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
  if (parts.length < 3 || parts.length > 4) return null
  const r = channel(parts[0])
  const g = channel(parts[1])
  const b = channel(parts[2])
  if (r === null || g === null || b === null) return null
  //alpha is either the 4th comma-separated value or the part after the slash
  const alphaToken = alphaPart ?? parts[3]
  const a = alphaToken === undefined ? 1 : alphaChannel(alphaToken)
  if (a === null) return null
  return { r, g, b, a }
}

function parseOkColor(fn: string, body: string): Rgba | null {
  const [coords, alphaPart] = body.split("/")
  const parts = coords.trim().split(/\s+/).filter(Boolean)
  if (parts.length !== 3) return null

  //L is 0–1 (100% = 1). C's percentage reference is 0.4, per CSS Color 4.
  const L = okNumber(parts[0], 1)
  if (L === null) return null

  let a: number | null
  let b: number | null
  if (fn === "oklch") {
    const chroma = okNumber(parts[1], 0.4)
    const hue = hueDegrees(parts[2])
    if (chroma === null || hue === null) return null
    const radians = (hue * Math.PI) / 180
    a = chroma * Math.cos(radians)
    b = chroma * Math.sin(radians)
  } else {
    a = okNumber(parts[1], 0.4)
    b = okNumber(parts[2], 0.4)
    if (a === null || b === null) return null
  }

  const alpha = alphaPart === undefined ? 1 : alphaChannel(alphaPart)
  if (alpha === null) return null
  return { ...oklabToRgb(L, a, b), a: alpha }
}

/** `#rrggbb`. Alpha is dropped: every surface this feeds is opaque by definition. */
export function formatHex({ r, g, b }: Rgb): string {
  const hex = (value: number) =>
    Math.round(clamp255(value)).toString(16).padStart(2, "0")
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/**
 * `top` laid over an opaque `bottom` — plain source-over, which is what the compositor does when
 * a translucent scrim covers a page.
 */
export function compositeOver(top: Rgba, bottom: Rgb): Rgb {
  const a = Math.min(1, Math.max(0, top.a))
  return {
    r: bottom.r + (top.r - bottom.r) * a,
    g: bottom.g + (top.g - bottom.g) * a,
    b: bottom.b + (top.b - bottom.b) * a,
  }
}

/**
 * `from` → `to` at `t` in `[0,1]`, per channel.
 *
 * Linear per-channel, and that is load-bearing rather than the lazy default: source-over is itself
 * linear in the source alpha, so mixing the two *endpoint* colours at `t` gives exactly the colour
 * of a scrim composited at `t` of its own opacity. A caller fading a scrim in therefore does not
 * need to know the scrim exists — it can tween between "before" and "after" and be pixel-correct
 * at every frame in between. `color.test.ts` pins that identity.
 */
export function mixRgb(from: Rgb, to: Rgb, t: number): Rgb {
  const s = Math.min(1, Math.max(0, t))
  return {
    r: from.r + (to.r - from.r) * s,
    g: from.g + (to.g - from.g) * s,
    b: from.b + (to.b - from.b) * s,
  }
}
