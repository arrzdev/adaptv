// The "dev server offline" screen. During `adaptv dev`, the native WebViews load from
// the Vite dev server (`server.url`). When that server isn't running — the app opened
// with no `adaptv dev`, or the process was killed — the WebView's load fails and, with
// nothing to show, it paints black. Capacitor's `server.errorPath` is its answer: on a
// main-frame load failure it loads a LOCAL file (served by the always-registered
// `capacitor://localhost` / `http://localhost` asset handler, independent of the remote
// `server.url`). We point errorPath at this generated page so the dev sees a branded
// "run `adaptv dev`" screen instead of black, and it auto-reconnects the moment the
// server is back.
//
// Why this file is GENERATED per run (not shipped static): two things it needs are the
// APP's, not adaptv's. The dev server URL is only known at runtime and has to be baked in
// for the page to navigate back, and the colours come from `adaptv.config.ts` so the screen
// belongs to the app rather than to the framework (see the palette note below). It's written
// into the web dir so `cap sync` copies it into each platform's `public/`, and removed on
// teardown so a committed build never ships it.
import { rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { loadAdaptvModule } from "./load-ts.mjs"
import { CAP_WEB_DIR } from "./native.mjs"
import { SHELL_ENDPOINT, shellIdFromUserAgent } from "./native-shell.mjs"

/** The errorPath filename, relative to the web dir root. Shared with `patchServerUrl`. */
export const OFFLINE_PAGE = "adaptv-offline.html"

/**
 * The Android WebView floor. Mirrors `MIN_ANDROID_WEBVIEW` in `src/vite/capacitor-config.ts`,
 * which is where the measurement and the reasoning live; `capacitor-config.test.ts` fails if
 * the two drift. Needed HERE because this page renders the screen that gate shows, and the
 * page has to name the number.
 */
export const MIN_ANDROID_WEBVIEW = 111

/**
 * How many consecutive reachable-but-not-ready answers (a 4xx/5xx) the reconnect probe waits
 * out before navigating anyway. Vite throws a 500 while it re-optimizes deps on the first
 * request, and navigating into that boots the app onto an error page for a beat; but a
 * genuinely 500-ing app must still let the dev back in to see the error, so the wait is bounded.
 */
export const NOT_READY_LIMIT = 5

/**
 * The reconnect probe's one decision, given the status the dev server answered with.
 *
 * Returns the verdict and the consecutive-not-ready count to carry to the next probe:
 *  - `go`    — 2xx/3xx, the app is actually serving; or a not-ready answer that has now
 *              persisted for `limit` tries.
 *  - `wait`  — reachable but not ready (a 4xx/5xx under the limit).
 *  - `never` — status 0: nothing answered. The screen must not flicker while the server is
 *              down, so an unreachable server never navigates however long it stays that way.
 *
 * This function's SOURCE is embedded in the page (`String(reconnectDecision)`), which is what
 * lets a unit test exercise the page's own logic rather than a copy of it. So it must stay plain
 * ES5 with no free variables: the limit arrives as an argument, not through a closure.
 *
 * @param {number} status
 * @param {number} notReadyTries
 * @param {number} limit
 * @returns {{ verdict: "go" | "wait" | "never", tries: number }}
 */
export function reconnectDecision(status, notReadyTries, limit) {
  if (status >= 200 && status < 400)
    return { verdict: "go", tries: notReadyTries }
  if (status > 0) {
    notReadyTries += 1
    return {
      verdict: notReadyTries >= limit ? "go" : "wait",
      tries: notReadyTries,
    }
  }
  return { verdict: "never", tries: notReadyTries }
}

/**
 * The page's reading of the dev server's native-shell answer (`src/shell/native-shell.ts`).
 *
 * `match` is the only answer that lets the page go back to the dev server; `pending`, `stale` and
 * `unserved` each keep it waiting with their own copy; `none` — nothing answered, a non-2xx, a body that is
 * not the verdict — is the plain "couldn't reach" state. The body arrives parsed on iOS (the
 * native request decodes JSON) and as text on Android (a WebView `fetch`), so both are taken.
 *
 * Embedded in the page as source like {@link reconnectDecision}: no free variables.
 *
 * @param {number} status
 * @param {any} body
 * @returns {"match" | "pending" | "stale" | "unserved" | "none"}
 */
export function shellAnswer(status, body) {
  if (!(status >= 200 && status < 300)) return "none"
  let data = body
  if (typeof data === "string") {
    try {
      data = JSON.parse(data)
    } catch (_) {
      return "none"
    }
  }
  const verdict = data && typeof data === "object" ? data.verdict : null
  return verdict === "match" ||
    verdict === "pending" ||
    verdict === "stale" ||
    verdict === "unserved"
    ? verdict
    : "none"
}

/**
 * Write the error screen into `<appRoot>/<webDir>/adaptv-offline.html`.
 *
 * `url` is the dev server, baked in so the page can navigate back to it — pass `null` for
 * `preview`/`build`, where there is nothing to reconnect to and the page exists only for
 * the WebView-too-old case. `config` is the app's `adaptv.config.ts`, which is where the
 * page's colours come from. Returns a revert fn that deletes the file; `dev` registers it
 * as a cleanup (the next `cap sync` drops it from `public/`), production does NOT — there
 * the page has to ship inside the app.
 */
export async function installOfflinePage(appRoot, { url = null, config }) {
  const dest = path.join(appRoot, CAP_WEB_DIR, OFFLINE_PAGE)
  writeFileSync(dest, await renderOfflineHtml(url, config))
  return () => {
    try {
      rmSync(dest)
    } catch {}
  }
}

/* =============================================================================
 * The palette — derived from `adaptv.config.ts`, at build time, in this process.
 *
 * This screen used to carry three hardcoded near-black tones. They were the playground's
 * own `themeColor.dark` and two greys sampled off it, so on that one app the page looked
 * native and on a light-themed app it was a black rectangle with nothing of the app in
 * it. `themeColor` is the value every OTHER surface that paints a background already
 * answers to — the pre-paint script, the critical CSS, the manifest, the iOS splash
 * colourset, Android's `colors.xml` — and there is no reason for the one screen a dev
 * sees when things are broken to be the exception.
 *
 * ## Why the config's ONE colour becomes a whole ramp
 *
 * `themeColor` declares a background per appearance and nothing else, while the page needs
 * a raised surface, a hairline, and four levels of text. Every tone but the background is
 * therefore derived, and the derivation is the same idea twice: **mix the base towards the
 * ink, or the ink back towards the base.**
 *
 * Mixing towards the ink rather than towards white (or towards a fixed grey) is the whole
 * trick, and it is what keeps a saturated or unusual `themeColor` from going muddy. The
 * ink is neutral, so a mix from the background towards it moves lightness and leaves the
 * hue alone — a deep indigo page gets a slightly lighter indigo command box, not a grey
 * one. And because the ink is picked FOR contrast (below), a mix in its direction is
 * always a mix in the direction that is guaranteed to become visible. A fixed lift would
 * have to pick a direction blind: lighten, and a white app's surfaces vanish into the
 * page; darken, and a near-black app's do.
 *
 * ## Contrast is computed, never assumed
 *
 * The ink is pure white or pure black, whichever measures higher against the resolved
 * background. That is not a preference, it is a floor with a proof: the two candidates
 * cross over at a background luminance of 0.179, where both measure 4.58:1, and away from
 * that point one of them only climbs. So the strongest text on this page clears WCAG AA
 * (4.5:1) against ANY sRGB colour a config can name, including the worst one.
 *
 * The dimmer tones are then mixes back towards the background, and each is defined by the
 * CONTRAST RATIO it should land on rather than by how far along that mix it sits (see
 * {@link TONES}). Naming the distance instead was the first attempt and it does not survive
 * the light case: sRGB is gamma-encoded, so 57% of the way from white towards a near-black
 * page and 57% of the way from black towards a near-white one are nowhere near the same
 * step down, and a ramp tuned on the dark theme collapsed into two indistinguishable greys
 * on the light one. A ratio is the same perceptual distance in both directions by
 * definition, so ONE table describes the hierarchy for every background, and the numbers in
 * it are the ratios the hardcoded page already had, measured off its own greys.
 *
 * When a background cannot reach a tone's ratio at all, that tone pins to the ink. A
 * mid-tone background therefore compresses the ramp from the bottom up and the screen reads
 * flatter. Losing the hierarchy is the correct way to lose: this is the page whose only job
 * is to be legible after everything else has failed.
 * ============================================================================= */

/** WCAG AA for body text. The floor for anything on this page that carries the message. */
const AA = 4.5

/** Surfaces, as a fraction of the way from the background TOWARDS the ink. */
const SURFACE = 0.045
const BORDER = 0.12
const TRACK = 0.14

/**
 * Text tones, as the contrast ratio each should hit against the command box (the lowest-
 * contrast surface on the page, so a tone that clears it clears the page background too).
 *
 * Every number is measured off the hardcoded page this replaced, so a dark-themed app gets
 * the screen it already had. The one change is `faint`, the `$` in front of the command:
 * that was 2.57:1 and is now 3, WCAG's non-text floor. It is the only tone on the page with
 * no meaning of its own, so it is the one that can afford to sit at the floor, and it should
 * not sit under it.
 */
const TONES = {
  body: 15.7,
  muted: 6.67,
  spinner: 5.38,
  dim: 3.69,
  faint: 3,
}

/** WCAG relative luminance of an 8-bit sRGB colour. */
function relativeLuminance({ r, g, b }) {
  const light = (value) => {
    const c = value / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * light(r) + 0.7152 * light(g) + 0.0722 * light(b)
}

/** The WCAG contrast ratio between two opaque colours, in `[1, 21]`. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** 8-bit sRGB, which is the only thing the page can actually carry. */
function quantize({ r, g, b }) {
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) }
}

/**
 * `from` mixed as far towards `to` as it can go while still clearing `min` against
 * `against`, and never past `want`.
 *
 * Bisection is exact enough because contrast along this segment is monotonic: every channel
 * moves in one direction as `t` grows, so luminance does too, and so does the ratio. Twenty
 * halvings of a span no wider than 1 leave an error far under one 8-bit step. When even
 * `t = 0` cannot reach `min` there is nothing better than `from` itself, and that is what
 * comes back.
 *
 * The candidate is QUANTIZED before it is measured. Bisecting on the continuous mix and
 * rounding afterwards let a tone land at 4.49:1 against a floor of 4.5 — true of the colour
 * that was solved for, false of the colour that ships, and a guarantee that is only true of
 * a number nobody sees is not a guarantee.
 */
function cappedMix(mixRgb, from, to, want, against, min) {
  const at = (t) => quantize(mixRgb(from, to, t))
  const clears = (t) => contrastRatio(at(t), against) >= min
  if (clears(want)) return at(want)
  let lo = 0
  let hi = want
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (clears(mid)) lo = mid
    else hi = mid
  }
  return at(lo)
}

/**
 * The full page palette for one background colour, plus the `color-scheme` that background
 * implies. Every value is `#rrggbb`; the page carries no colour this did not produce.
 */
export async function offlinePalette(background) {
  const { formatHex, mixRgb, parseCssColor } =
    await loadAdaptvModule("utils/color.ts")
  const bg = parseCssColor(background)
  if (!bg)
    throw new Error(
      `the offline screen needs a hex theme colour, got ${JSON.stringify(background)}`,
    )
  const white = { r: 255, g: 255, b: 255 }
  const black = { r: 0, g: 0, b: 0 }
  const ink =
    contrastRatio(white, bg) >= contrastRatio(black, bg) ? white : black

  // The command box HOLDS text, so its fill answers to the same floor that text does: it may
  // only lift off the background as far as it can without pushing the ink under AA. On a
  // mid-tone background the fill flattens away to nothing and the hairline alone draws the
  // box, which is the right way to lose that one: a box you can read beats a box you can see.
  const surface = cappedMix(mixRgb, bg, ink, SURFACE, ink, AA)
  // Every text tone is measured against the SURFACE, not the page background. The surface is
  // the lower-contrast of the two by construction (it is the background, moved towards the
  // ink), so a tone that clears it clears the page too, and ONE number then describes that
  // tone wherever on the page it is used.
  const tone = (target) =>
    formatHex(cappedMix(mixRgb, ink, bg, 1, surface, target))

  return {
    scheme: ink === white ? "dark" : "light",
    background: formatHex(bg),
    surface: formatHex(surface),
    border: formatHex(mixRgb(bg, ink, BORDER)),
    track: formatHex(mixRgb(bg, ink, TRACK)),
    strong: formatHex(ink),
    body: tone(TONES.body),
    muted: tone(TONES.muted),
    spinner: tone(TONES.spinner),
    dim: tone(TONES.dim),
    faint: tone(TONES.faint),
  }
}

/** One palette as custom properties, for a `:root` block. */
function paletteVars(palette) {
  return [
    `--bg:${palette.background}`,
    `--surface:${palette.surface}`,
    `--border:${palette.border}`,
    `--track:${palette.track}`,
    `--strong:${palette.strong}`,
    `--body:${palette.body}`,
    `--muted:${palette.muted}`,
    `--spinner:${palette.spinner}`,
    `--dim:${palette.dim}`,
    `--faint:${palette.faint}`,
  ].join(";")
}

/**
 * The page's two palettes and the `color-scheme` they run under, resolved the way the app's
 * own pre-paint script resolves them (`src/shell/theme-init-script.ts`): a pinned
 * `defaultThemePreference` paints that one appearance, and `"system"` follows the device.
 *
 * The one arm the script has that this page cannot have is the dev's SAVED preference. That
 * lives in `localStorage` on the dev server's origin, and this page is served from the local
 * asset handler — `capacitor://localhost` or `http://localhost` with no port — so it is a
 * different origin on both platforms and the value is unreachable by construction, not by
 * omission. A dev who forced light on a dark device therefore sees the dark screen here.
 * That is one appearance out of step on a screen that used to be one appearance out of step
 * for everybody.
 */
async function themeCss(config) {
  const { resolveThemeColors } = await loadAdaptvModule(
    "config/app-config.ts",
  )
  const theme = resolveThemeColors(config.themeColor)
  const preference = config.defaultThemePreference ?? "system"
  if (preference === "light" || preference === "dark") {
    const palette = await offlinePalette(theme[preference])
    return {
      scheme: palette.scheme,
      css: `:root { color-scheme: ${palette.scheme}; ${paletteVars(palette)} }`,
    }
  }
  const light = await offlinePalette(theme.light)
  const dark = await offlinePalette(theme.dark)
  return {
    scheme: "light dark",
    css:
      `:root { color-scheme: light dark; ${paletteVars(light)} }\n` +
      `  @media (prefers-color-scheme: dark) { :root { ${paletteVars(dark)} } }`,
  }
}

/**
 * The self-contained offline page. Single file, no imports, no bundling — it's served
 * by Capacitor's local asset handler with the native bridge already injected, so it can
 * hide the OS splash and read the platform straight off `window.Capacitor`.
 *
 * ## Reconnecting without a black flash (the hard part)
 *
 * Both platforms serve this page from a SECURE local origin — `capacitor://localhost`
 * on iOS, `https://localhost` on Android — while the dev server is cleartext
 * `http://localhost:<port>`. That rules out every in-page reachability probe: `fetch`,
 * `XHR`, `WebSocket`, even an `<img>` ping are all mixed-content-blocked from a secure
 * origin to `http://`. A blind "navigate and bounce back on failure" retry is worse — on
 * Android each failed top-level navigation blanks the WebView before the errorPath
 * reload, so it strobes black.
 *
 * The reliable signal is `CapacitorHttp`, a core plugin that runs the request in NATIVE
 * code, so it's exempt from the WebView's mixed-content policy. We poll it on an interval
 * and navigate to the dev server ONLY once it actually answers — so the screen stays put
 * while the server is down and swaps to the app the instant it's back, with no flicker.
 *
 * Bridge availability differs by platform, and both cases are handled:
 * - **iOS** injects `window.Capacitor` into every page (a WKUserScript), so `CapacitorHttp`
 *   is available and the screen auto-reconnects the moment the server is back.
 * - **Android does NOT inject the bridge into the errorPath page.** Verified in the
 *   Capacitor source: `Bridge.loadWebView()` registers the bridge with
 *   `addDocumentStartJavaScript` scoped to a SINGLE origin (`appUrl` — in live-reload
 *   that's the dev server) and then NULLS the local-server injector, so a page served
 *   from the local origin gets nothing. `CapacitorHttp` is therefore unreachable there,
 *   and so is `SplashScreen.hide()` — which is why the CLI forces `launchAutoHide` on the
 *   dev config so the splash clears and reveals this screen (see `patchServerUrl`).
 *   Android reconnects via the plain-`fetch` route instead, which the CLI enables by
 *   setting `server.androidScheme:"http"` for the dev session.
 *
 * Never blind-bounce (navigate and let a failed load bounce back here): it strobes the
 * Android WebView black on every attempt.
 *
 * ## The mark
 *
 * `assets/adaptv-mark.svg` with the background rect dropped and the viewBox tightened to the
 * artwork, drawn in `currentColor` so it takes whichever ink the config's background asked
 * for. Inlined rather than linked: `cap sync` copies this ONE file into each platform's
 * `public/`, so anything it references by URL would 404 on the device.
 */
/*
 * ## Why ONE page serves two unrelated failures
 *
 * Capacitor gives exactly one `server.errorPath`, and `Bridge.loadWebView()` routes BOTH a
 * failed main-frame load AND `minWebViewVersion` not being met through it. So this page has
 * to tell them apart itself, or an ancient WebView would be told "couldn't reach dev server"
 * — a lie, and one the dev would chase for an hour.
 *
 * It can, with no bridge: the WebView's own user-agent carries the Chromium major, and that
 * is the whole test. The version branch runs FIRST and is terminal — no reconnect loop, no
 * dev-server probing, because neither has anything to do with the failure.
 */
async function renderOfflineHtml(devUrl, config) {
  const url = JSON.stringify(devUrl)
  const theme = await themeCss(config)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="${theme.scheme}" />
<title>adaptv · dev build</title>
<style>
  ${theme.css}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    background: var(--bg);
    color: var(--body);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    display: flex; align-items: center; justify-content: center;
    padding: calc(env(safe-area-inset-top) + 24px) 24px calc(env(safe-area-inset-bottom) + 24px);
    text-align: center;
    user-select: none; -webkit-user-select: none;
    overflow: hidden;
  }
  .wrap { width: 100%; max-width: 340px; display: flex; flex-direction: column; align-items: center; gap: 24px; }
  .brand { display: flex; flex-direction: column; align-items: center; gap: 12px; color: var(--strong); }
  .brand svg { width: 62px; height: 62px; display: block; }
  .brand span { font-size: 12.5px; font-weight: 600; letter-spacing: 0.08em; color: var(--dim); }
  h1 { font-size: 19px; font-weight: 620; letter-spacing: -0.01em; color: var(--strong); }
  p { color: var(--muted); font-size: 14px; margin-top: 7px; }
  .cmd {
    width: 100%;
    background: var(--surface); border: 1px solid var(--border); border-radius: 11px;
    padding: 13px 16px; margin-top: 2px;
    font: 13.5px/1.4 ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    color: var(--body); text-align: left;
    display: flex; align-items: center; gap: 9px;
  }
  .cmd .sigil { color: var(--faint); }
  .cmd .run { color: var(--strong); }
  .status { display: inline-flex; align-items: center; gap: 8px; color: var(--dim); font-size: 12.5px; }
  .spin {
    width: 12px; height: 12px; border-radius: 50%;
    border: 1.5px solid var(--track); border-top-color: var(--spinner);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <svg viewBox="192 192 640 640" fill="none" aria-hidden="true"><circle cx="512" cy="512" r="164" fill="currentColor"/><g stroke="currentColor" stroke-width="100" stroke-linecap="round" stroke-linejoin="round"><path d="M256 400V296H360"/><path d="M768 624V728H664"/></g></svg>
      <span>adaptv</span>
    </div>
    <div>
      <h1 id="title">Couldn't reach dev server</h1>
      <p id="detail">This is a development build</p>
    </div>
    <div class="cmd" id="cmd"><span class="sigil">$</span><span><span class="run">adaptv dev</span> <span id="platform">ios</span></span></div>
    <div class="status" id="status"><span class="spin"></span><span id="status-text">Reconnecting automatically…</span></div>
  </div>
<script>
  (function () {
    var DEV_URL = ${url};
    var MIN_WEBVIEW = ${MIN_ANDROID_WEBVIEW};

    // ---- the WebView floor, checked first and terminal -----------------------------
    // Capacitor sends BOTH "main frame failed to load" and "WebView older than
    // android.minWebViewVersion" to this one page. Only the user-agent can separate them,
    // and it needs no bridge — which matters, because Android injects none here.
    function chromiumMajor() {
      var m = /Chrome\\/(\\d+)/.exec(navigator.userAgent || "");
      return m ? parseInt(m[1], 10) : 0;
    }

    function showOutdatedWebView(major) {
      document.title = "adaptv · update WebView";
      document.getElementById("title").textContent = "Update Android System WebView";
      document.getElementById("detail").textContent =
        "This app needs WebView " + MIN_WEBVIEW + " or newer to render correctly. " +
        "This device has " + (major || "an unknown version") + ".";
      var cmd = document.getElementById("cmd");
      cmd.innerHTML = "";
      cmd.appendChild(document.createTextNode("Update \\u201CAndroid System WebView\\u201D in the Play Store, then reopen."));
      // no spinner: nothing here resolves itself, and a spinner would promise that it does
      document.getElementById("status").remove();
    }

    var major = chromiumMajor();
    // \`major > 0\` guards iOS, where there is no Chrome token at all and the floor
    // does not apply — WebKit is versioned with the OS.
    if (major > 0 && major < MIN_WEBVIEW) { showOutdatedWebView(major); return; }

    // ---- past here: a genuine load failure ------------------------------------------
    // Production has no dev server to go back to, so there is nothing to probe. Say what
    // happened and stop, rather than spinning forever on a reconnect that cannot happen.
    if (!DEV_URL) {
      document.getElementById("title").textContent = "Couldn't load the app";
      document.getElementById("detail").textContent = "Reopen the app to try again.";
      document.getElementById("cmd").remove();
      document.getElementById("status").remove();
      return;
    }

    var navigating = false;
    var splashHidden = false;
    // Consecutive answers that were reachable but NOT 2xx/3xx (e.g. a 500 Vite throws
    // while it re-optimizes deps on the first request). We wait those out rather than
    // navigating into a broken boot — but give up waiting after this many, so a genuinely
    // 500-ing app still lets the dev back in to see the error.
    var notReadyTries = 0;
    var NOT_READY_LIMIT = ${NOT_READY_LIMIT};
    // The decision itself, verbatim from the CLI module so the test and the page agree.
    ${String(reconnectDecision)}

    // ---- is this app the build the dev session serves? ----------------------------------
    // A dev build carries its native build's id in the user agent. The dev server answers
    // whether that id is the one this run installed or reused; only then does the page go back.
    // Anything else waits here — an app from before a native change must not come up inside
    // the old binary while the new one is still being built. → src/shell/native-shell.ts
    ${String(shellIdFromUserAgent)}
    ${String(shellAnswer)}
    var SHELL_URL = DEV_URL.replace(/\\/$/, "") + ${JSON.stringify(SHELL_ENDPOINT)} +
      "?id=" + encodeURIComponent(shellIdFromUserAgent(navigator.userAgent) || "");

    // One screen, four states. "none" is the page as it has always been: the server is not
    // answering. "pending" and "stale" drop the command, which the dev is already running.
    // "unserved" keeps it: the run that is up leaves this platform out, so no build is coming,
    // and the command that would serve it is the one thing worth showing.
    var STATES = {
      none: ["Couldn't reach dev server", "This is a development build", "Reconnecting automatically\u2026"],
      pending: ["Checking this build", "The dev server is up. The app opens once this install is confirmed current.", "Waiting for adaptv\u2026"],
      stale: ["Waiting for the new build", "This install is out of date. The rebuilt app opens on its own.", "Waiting for the rebuild\u2026"],
      unserved: ["Not part of this run", "The dev server is up, but this run isn't serving this platform.", "Waiting for a run that includes it\u2026"]
    };
    var painted = "none";
    function paint(state) {
      var copy = STATES[state] || STATES.none;
      if (painted === state) return;
      painted = state;
      document.getElementById("title").textContent = copy[0];
      document.getElementById("detail").textContent = copy[1];
      document.getElementById("status-text").textContent = copy[2];
      document.getElementById("cmd").style.display = state === "none" || state === "unserved" ? "" : "none";
    }

    // Platform for the command hint. Prefer the bridge; fall back to the local origin's
    // scheme, which is set even before the bridge is injected (iOS = capacitor:, Android
    // serves this page from https://localhost).
    function platformOf() {
      var cap = window.Capacitor;
      if (cap && cap.getPlatform) return cap.getPlatform();
      if (location.protocol === "capacitor:") return "ios";
      if (location.hostname === "localhost") return "android";
      return "web";
    }

    // Anything that isn't a native WebView falls back to \`web\`, not to nothing. The blank
    // this used to print reasoned that the page only ever loads on a device, so a platform
    // it couldn't detect wasn't worth naming — but that left \`adaptv dev\` with no target,
    // and \`targetsFor\` rejects that ("unknown dev target"). Every branch here has to name
    // a target the CLI takes, and \`web\` is one.
    function paintPlatform() {
      var p = platformOf();
      var el = document.getElementById("platform");
      if (el) el.textContent = p === "android" ? "android" : p === "ios" ? "ios" : "web";
    }

    // Hide the OS splash so this screen is visible (config sets launchAutoHide:false, so
    // nothing else clears it on a static page). Retried from the loop until the bridge
    // is ready and the call sticks.
    function hideSplash() {
      if (splashHidden) return;
      var sp = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SplashScreen;
      if (!sp) return;
      try { sp.hide(); splashHidden = true; } catch (e) {}
    }

    function go() {
      if (navigating) return;
      navigating = true;
      try { location.replace(DEV_URL); } catch (e) { location.href = DEV_URL; }
    }

    // Reachability probe. Navigate ONLY on a real answer, so the screen never flickers
    // while the server is down — and only once the dev server says this app is the build it
    // serves (\`shellAnswer\` above). Two routes, because neither works everywhere:
    //  1. \`CapacitorHttp\` — runs in native code, exempt from the WebView's mixed-content
    //     block. Available on iOS (bridge injected on every page).
    //  2. a plain \`fetch\` — only usable when THIS page's origin is already cleartext, so
    //     the request isn't mixed content. That's the Android case: the CLI sets
    //     \`server.androidScheme:"http"\` for the dev session precisely so this works
    //     (Android never gets the bridge here, so route 1 is unavailable). The dev server
    //     answers the shell check with an open CORS header, so the page can read it.
    // Neither available -> do nothing; the next \`adaptv dev\` relaunches the app.
    function probe() {
      hideSplash();
      paintPlatform();
      if (navigating) return;
      var http = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
      if (http && http.request) {
        http
          .request({ url: SHELL_URL, method: "GET", connectTimeout: 2500, readTimeout: 2500 })
          .then(function (shell) {
            var answer = shellAnswer(shell && typeof shell.status === "number" ? shell.status : 0, shell && shell.data);
            paint(answer === "match" ? "none" : answer);
            if (answer !== "match") return;
            return http
              .request({ url: DEV_URL, method: "HEAD", connectTimeout: 2500, readTimeout: 2500 })
              .then(function (res) {
                var s = res && typeof res.status === "number" ? res.status : 0;
                // 2xx/3xx = the app is actually serving → reconnect. A 5xx/4xx means the
                // server answered but isn't ready (Vite still booting): wait it out, but
                // reconnect anyway once it persists, so a real app error isn't a dead end.
                var d = reconnectDecision(s, notReadyTries, NOT_READY_LIMIT);
                notReadyTries = d.tries;
                if (d.verdict === "go") go();
              });
          })
          .catch(function () { paint("none"); });
        return;
      }
      if (location.protocol === "http:") {
        // same-scheme, so not mixed content
        fetch(SHELL_URL, { cache: "no-store" })
          .then(function (res) {
            return res.text().then(function (text) { return shellAnswer(res.status, text); });
          })
          .then(function (answer) {
            paint(answer === "match" ? "none" : answer);
            if (answer === "match") go();
          })
          .catch(function () { paint("none"); });
      }
    }

    setInterval(probe, 2000);
    setTimeout(probe, 300);
  })();
</script>
</body>
</html>
`
}
