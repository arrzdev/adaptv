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
// Why this file is GENERATED per run (not shipped static): the dev server URL is only
// known at runtime, and the page needs it baked in to navigate back. It's written into
// the web dir so `cap sync` copies it into each platform's `public/`, and removed on
// teardown so a committed build never ships it.
import { rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { CAP_WEB_DIR } from "./native.mjs"

/** The errorPath filename, relative to the web dir root. Shared with `patchServerUrl`. */
export const OFFLINE_PAGE = "adaptv-offline.html"

/**
 * Write the offline screen into `<appRoot>/<webDir>/adaptv-offline.html`, with the dev
 * server `url` baked in so the page can navigate back to it. Returns a revert fn that
 * deletes the file (the next `cap sync` then drops it from `public/`).
 */
export function installOfflinePage(appRoot, { url }) {
  const dest = path.join(appRoot, CAP_WEB_DIR, OFFLINE_PAGE)
  writeFileSync(dest, renderOfflineHtml(url))
  return () => {
    try {
      rmSync(dest)
    } catch {}
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
 */
function renderOfflineHtml(devUrl) {
  const url = JSON.stringify(devUrl)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="dark" />
<title>adaptv · dev build</title>
<style>
  :root { color-scheme: dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    background: #0a0a0c;
    color: #ededf0;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    display: flex; align-items: center; justify-content: center;
    padding: calc(env(safe-area-inset-top) + 24px) 24px calc(env(safe-area-inset-bottom) + 24px);
    text-align: center;
    user-select: none; -webkit-user-select: none;
    overflow: hidden;
  }
  .wrap { width: 100%; max-width: 340px; display: flex; flex-direction: column; align-items: center; gap: 22px; }
  .mark {
    font-weight: 650; font-size: 15px; letter-spacing: -0.02em; color: #fff;
    display: inline-flex; align-items: center; gap: 8px;
  }
  .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #4ade80; box-shadow: 0 0 0 0 rgba(74,222,128,0.55);
    animation: pulse 1.8s ease-out infinite;
  }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(74,222,128,0.5); }
    70% { box-shadow: 0 0 0 9px rgba(74,222,128,0); }
    100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); }
  }
  h1 { font-size: 19px; font-weight: 620; letter-spacing: -0.01em; color: #fff; }
  p { color: #9b9ba4; font-size: 14px; }
  .cmd {
    width: 100%;
    background: #141418; border: 1px solid #26262e; border-radius: 11px;
    padding: 13px 16px; margin-top: 2px;
    font: 13.5px/1.4 ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
    color: #ededf0; text-align: left;
    display: flex; align-items: center; gap: 9px;
  }
  .cmd .sigil { color: #57575f; }
  .cmd .run { color: #fff; }
  .status { display: inline-flex; align-items: center; gap: 8px; color: #6f6f78; font-size: 12.5px; }
  .spin {
    width: 12px; height: 12px; border-radius: 50%;
    border: 1.5px solid #2a2a32; border-top-color: #8a8a94;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="mark"><span class="dot"></span>adaptv</div>
    <div>
      <h1>Development build</h1>
      <p>The dev server isn't running.</p>
    </div>
    <div class="cmd"><span class="sigil">$</span><span><span class="run">adaptv dev</span> <span id="platform">ios</span></span></div>
    <div class="status"><span class="spin"></span><span>Waiting for the dev server…</span></div>
  </div>
<script>
  (function () {
    var DEV_URL = ${url};
    var navigating = false;
    var splashHidden = false;

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

    function paintPlatform() {
      var p = platformOf();
      var el = document.getElementById("platform");
      if (el) el.textContent = p === "android" ? "android" : p === "ios" ? "ios" : "";
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
    // while the server is down. Two routes, because neither works everywhere:
    //  1. \`CapacitorHttp\` — runs in native code, exempt from the WebView's mixed-content
    //     block. Available on iOS (bridge injected on every page).
    //  2. a plain \`fetch\` — only usable when THIS page's origin is already cleartext, so
    //     the request isn't mixed content. That's the Android case: the CLI sets
    //     \`server.androidScheme:"http"\` for the dev session precisely so this works
    //     (Android never gets the bridge here, so route 1 is unavailable).
    // Neither available -> do nothing; the next \`adaptv dev\` relaunches the app.
    function probe() {
      hideSplash();
      paintPlatform();
      if (navigating) return;
      var http = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
      if (http && http.request) {
        http
          .request({ url: DEV_URL, method: "HEAD", connectTimeout: 2500, readTimeout: 2500 })
          .then(function (res) {
            // any HTTP answer (even a 500 while Vite boots) means the server is back
            if (res && typeof res.status === "number" && res.status > 0) go();
          })
          .catch(function () {});
        return;
      }
      if (location.protocol === "http:") {
        // same-scheme, so not mixed content; opaque response = reachable.
        fetch(DEV_URL, { method: "HEAD", mode: "no-cors", cache: "no-store" })
          .then(function () { go(); })
          .catch(function () {});
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
