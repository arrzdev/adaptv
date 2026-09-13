import {
  DEV_BUNDLE_RAN_KEY,
  OFFLINE_AFTER_FAILURES,
  OFFLINE_PAGE,
} from "#adaptv/shell/native-live-reload-client"

/** How often the watchdog asks whether the dev server is still there, while the bundle has not run. */
export const DEV_BOOT_POLL_MS = 1000

/**
 * The native dev document's watchdog for a bundle that never ran, as an inline script.
 *
 * ## The gap it closes
 *
 * `adaptv dev ios|android` loads the app from the dev server, and two things already take the
 * WebView to the offline screen when that server goes away. Capacitor's `server.errorPath` does
 * it when the DOCUMENT fails to load. `installNativeLiveReloadRecovery` does it once the bundle
 * is running. Between the two there is a window where neither can: the document has arrived
 * (so errorPath never fires) and the bundle has not run (so the recovery does not exist yet).
 * A server that dies in that window leaves the app on its own server-rendered splash for good,
 * with nothing on screen saying why and nothing that reconnects when the server comes back.
 *
 * It is not a rare window. Quitting the dev session right after pressing `r` hits it: `r`
 * relaunches the app, the WebView fetches the document about a second later, and a quit a
 * moment after that stops the server while the module graph is still loading. Measured on the
 * iOS 26.1 simulator: the document was `complete` with 250 resources loaded, the entry never
 * ran, no `error` event reached the document, and the splash was still up 40 seconds later.
 *
 * ## Why an inline script, and why it polls
 *
 * The only code that runs in that window is code already inside the document, which is the
 * same argument `boot-fallback.ts` makes for a broken production bundle. It polls rather than
 * listening for the entry script's `error` event because WebKit did not deliver one: the graph
 * stalled with its requests failed and no event fired.
 *
 * It navigates only when the server does not answer at all, twice in a row. A server that
 * answers, with any status, is up, and a dev bundle that throws on a code error is the dev's to
 * see there, not a reason to send them to a screen that says the server is gone. The offline
 * screen then reconnects on its own when `adaptv dev` runs again.
 *
 * Native only, read off the injected bridge, and dev only: the caller includes it in the
 * document under `import.meta.env.DEV`, so a production build carries none of it. ES5 with no
 * optional chaining, for the same reason as the boot fallback: it is the code left standing
 * after everything else did not arrive.
 */
export function getNativeDevBootWatchdogScript(): string {
  return `(function(){try{
var C=window.Capacitor;if(!(C&&C.isNativePlatform&&C.isNativePlatform()))return;
var K=${JSON.stringify(DEV_BUNDLE_RAN_KEY)},P=${DEV_BOOT_POLL_MS},N=${OFFLINE_AFTER_FAILURES},F=${JSON.stringify(OFFLINE_PAGE)},misses=0;
function offline(){var inj=window.WEBVIEW_SERVER_URL,base=null;
if(inj&&location.href.indexOf(inj)!==0)base=inj;
else{var os=C.getPlatform?C.getPlatform():"";base=os==="android"?"http://localhost":os==="ios"?"capacitor://localhost":null}
return base?base.replace(/\\/$/,"")+"/"+F:null}
function next(){setTimeout(tick,P)}
function tick(){if(window[K])return;
fetch(location.href,{method:"HEAD",cache:"no-store"}).then(function(){misses=0;next()},function(){
if(window[K])return;
if(document.visibilityState==="visible")misses+=1;
var t=misses>=N?offline():null;
if(t){location.replace(t);return}
next()})}
if(typeof fetch==="function")next()
}catch(e){}})();`
}
