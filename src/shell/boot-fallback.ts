/**
 * The boot fallback — the app's error screen, **without any JavaScript of its own**.
 * → `RENDERING.md §3.1.3`, `DECISIONS.md B31`
 *
 * ## The failure the React boundary cannot reach
 *
 * Runtime errors are the app's own to catch — a route that throws, a failed fetch,
 * a bad render. adaptv installs no boundary for those, deliberately, because doing
 * so would take that handling away from the app. This exists for the one failure
 * the app never got to have an opinion about: the bundle that never executes at all — a syntax error, a 404
 * on the entry chunk, a corrupt OTA bundle. React never runs, so nothing written
 * in React can render, and the WebView paints blank.
 *
 * ## Why a sandbox does not solve it, and what does
 *
 * The instinct is to isolate the error screen in an iframe. That isolates the
 * *execution scope* — fresh globals, clean context — but you still have to load a
 * script into it, and a script from a broken build is broken there too. The thing
 * that has to be isolated is the **build graph**, not the runtime.
 *
 * So the component is rendered to HTML at **build time** (`react-dom/server`) and
 * embedded, hidden, in the document itself. The dev still writes a normal React
 * component with normal Tailwind — it simply runs in Node rather than in the
 * browser. What ships is markup that is already inside the document the WebView
 * successfully loaded, which depends on no bundle at all.
 *
 * Its Tailwind comes free: adaptv's `styles/index.css` already declares
 * `@source "../**\/*.{ts,tsx}"`, so the classes are in the app stylesheet — a
 * separate file from the JS that broke. {@link getBootFallbackCss} is the floor
 * for the rarer case where the stylesheet is missing too.
 */

/** The app's mount point in the generated shell — `app-shell.ts` writes this id. */
export const APP_ROOT_ID = "root"

/** The hidden fallback container's id. Shared by the markup, the CSS and the script. */
export const BOOT_FALLBACK_ID = "adaptv-boot-fallback"

/**
 * Narrows which control reloads. **Optional** — see {@link getBootFallbackScript}
 * for why every `<button>` already works without it.
 */
export const BOOT_RETRY_ATTR = "data-adaptv-boot-retry"

/**
 * Labels a prerendered **variant** — one per boot code.
 *
 * The code reaches the component as a **prop**, which is the only shape that lets
 * an app branch on it in JSX. Static markup cannot be handed a prop at reveal
 * time, so the component is rendered once per code at build time and the watchdog
 * reveals the matching copy. When a component ignores `code` — as adaptv's default
 * deliberately does — every render is identical and collapses back to one copy,
 * so the mechanism costs nothing to anyone who does not use it.
 */
export const BOOT_CODE_ATTR = "data-adaptv-boot-code"

/**
 * Marks the document while the fallback is showing, **valued with the code** — so
 * the reason is one attribute read away for an e2e test, a screenshot, or a
 * telemetry hook that wants it without scraping the screen.
 */
export const BOOT_FAILED_ATTR = "data-adaptv-boot-failed"

/**
 * Why the boot failed, as far as the document can tell from outside the bundle.
 *
 * These are the four distinguishable signals, and the distinction is the point —
 * they point at different culprits. `LOAD` is a deploy or CDN problem: the file
 * is not being served. `THROW` and `REJECT` mean the file arrived and the code in
 * it is broken. `STALL` means it arrived, ran, raised nothing, and still never
 * mounted, which is the one that usually means a dependency below React.
 *
 * Short and stable on purpose: an app may branch on these, and they are stamped on
 * `<html>` for telemetry, so they must survive every rewording of the copy around
 * them. **adaptv's own screen never displays one** — showing a code is a product
 * decision, and it belongs to whoever overrides `bootErrorScreen`.
 */
export const BOOT_CODES = {
  /** The entry script could not be fetched — 404, offline, blocked. */
  load: "BOOT-LOAD",
  /** Something threw before React mounted. */
  throw: "BOOT-THROW",
  /** A promise rejected, unhandled, before React mounted. */
  reject: "BOOT-REJECT",
  /** No error at all, and nothing ever mounted. */
  stall: "BOOT-STALL",
} as const

export type BootCode = (typeof BOOT_CODES)[keyof typeof BOOT_CODES]

/**
 * How long to wait for React before assuming it is never coming.
 *
 * Only consulted when the mount point is still **empty**, so this is not a race
 * against a slow network on a server-rendered page — there, content is already
 * painted and the timeout never fires. It is the backstop for a bundle that
 * loaded and then failed silently, where no error event is dispatched at all.
 */
export const BOOT_GRACE_MS = 8000

/**
 * The fallback's structural CSS, inlined with the critical CSS.
 *
 * Deliberately **not** a copy of the component's styling — that is the app
 * stylesheet's job, and Tailwind has already put it there. This is the floor: if
 * the stylesheet is missing too, the screen must still be a centred, readable,
 * full-viewport surface rather than unstyled text in the corner. Colours are
 * inherited from the `html`/`body` background the critical CSS already sets, so
 * this stays theme-correct without repeating a single colour.
 */
export function getBootFallbackCss(): string {
  return (
    `#${BOOT_FALLBACK_ID}[hidden]{display:none!important}` +
    `#${BOOT_FALLBACK_ID}{position:fixed;inset:0;z-index:2147483647;` +
    `display:flex;flex-direction:column;align-items:center;justify-content:center;` +
    //the component's own `safe="all"` padding collapses to 0 in a browser tab
    //(there are no insets to honour there), so the gutter that keeps text off the
    //edges belongs to the container, not to the component
    `overflow:auto;padding:1.5rem;text-align:center;background-color:inherit}` +
    //only one per-code variant is ever revealed. Explicit rather than leaning on
    //the UA's default `[hidden]` style, which a `display:` on the component's own
    //root would quietly outrank.
    `[${BOOT_CODE_ATTR}][hidden]{display:none!important}`
  )
}

/**
 * The prerendered component(s), wrapped in the hidden container.
 *
 * `hidden` rather than a `display:none` class: the attribute works with no
 * stylesheet at all, which is the whole point of this path.
 *
 * **Identical renders collapse to one copy.** A component that ignores `code` —
 * adaptv's default, and probably most apps' — produces the same markup for all
 * four, and shipping four byte-identical copies of it in every document would be
 * pure waste. Only a component that actually branches on the code pays for the
 * variants it asked for.
 */
export function getBootFallbackMarkup(
  byCode: Readonly<Record<string, string>>,
): string {
  const entries = Object.entries(byCode)
  const distinct = new Set(entries.map(([, html]) => html))

  const body =
    distinct.size <= 1
      ? (entries[0]?.[1] ?? "")
      : entries
          .map(
            ([code, html]) =>
              `<div ${BOOT_CODE_ATTR}="${code}" hidden>${html}</div>`,
          )
          .join("")

  return `<div id="${BOOT_FALLBACK_ID}" hidden>${body}</div>`
}

/**
 * The watchdog, as an inline script. Small on purpose — every byte here runs in
 * the world where the real bundle already failed.
 *
 * ## The reveal policy, and why it keys on the mount point
 *
 * There is no boot flag and nothing to call from the app. The question "did the
 * app render?" is answered by looking: **the fallback shows only while the mount
 * point is empty.** That single rule gets three things right at once —
 *
 * - a server-rendered page that is merely slow to hydrate has content already, so
 *   the timeout can never replace good content with an error screen;
 * - an error thrown *after* the app mounted is the app's business, and is ignored
 *   here without needing to track boot state;
 * - a late mount that wins the race un-reveals the fallback, via the observer.
 *
 * ## Why every `<button>` reloads, with nothing asked of the component
 *
 * A prerendered `onClick` does not exist — a build-time render serializes no event
 * handlers — so something has to wire the only action on the screen. Requiring an
 * opt-in attribute would have made a forgotten spread produce a **dead button** at
 * the exact moment a reload is the only way out: a silent failure, which is the
 * one kind this codebase refuses to ship (`DECISIONS.md` L7).
 *
 * It is also unnecessary, because in a document where no app JavaScript is running
 * a `<button>` **has no other thing it could possibly do**. Anchors still navigate
 * natively and are left alone; a button is inert. So any button click reloads, and
 * that is a statement about what is reachable, not a guess about intent.
 *
 * {@link BOOT_RETRY_ATTR} remains as the precision tool: mark one control and only
 * that one reloads, which is what a screen with a second button wants.
 *
 * ## The first signal wins
 *
 * `show` is a no-op once the screen is up, and that guard is load-bearing rather
 * than defensive. Caught in a browser, not by a test: an entry script 404 revealed
 * the screen as `BOOT-LOAD`, and eight seconds later the stall timer fired and
 * **relabelled it `BOOT-STALL`** — turning the most specific diagnosis the document
 * had into the vaguest one. Signals arrive cheapest-first, so the earliest is
 * always the most specific.
 */
export function getBootFallbackScript(): string {
  //written as one ES5-safe IIFE with no optional chaining and no arrow functions:
  //this is the last code standing on a target whose bundle did not parse, and it
  //must never be the second thing that fails to.
  return `(function(){
var R=${JSON.stringify(APP_ROOT_ID)},F=${JSON.stringify(BOOT_FALLBACK_ID)},G=${BOOT_GRACE_MS};
var BF=${JSON.stringify(BOOT_FAILED_ATTR)},CD=${JSON.stringify(BOOT_CODE_ATTR)};
var RT=${JSON.stringify(BOOT_RETRY_ATTR)};
function root(){return document.getElementById(R)}
function box(){return document.getElementById(F)}
function booted(){var r=root();return !!r&&r.childElementCount>0}
function show(c){var b=box();if(!b||booted()||!b.hasAttribute("hidden"))return;
var v=b.querySelectorAll("["+CD+"]"),m=null;
for(var i=0;i<v.length;i++){if(v[i].getAttribute(CD)===c)m=v[i];else v[i].setAttribute("hidden","")}
if(!m&&v.length)m=v[0];
if(m)m.removeAttribute("hidden");
b.removeAttribute("hidden");document.documentElement.setAttribute(BF,c)}
function hide(){var b=box();if(!b)return;b.setAttribute("hidden","");document.documentElement.removeAttribute(BF)}
window.addEventListener("error",function(e){
if(e&&e.target&&e.target!==window&&e.target.tagName==="SCRIPT"){show(${JSON.stringify(BOOT_CODES.load)});return}
show(${JSON.stringify(BOOT_CODES.throw)})},true);
window.addEventListener("unhandledrejection",function(){show(${JSON.stringify(BOOT_CODES.reject)})},true);
function watch(){
var b=box();
if(b){b.addEventListener("click",function(e){
var x=b.querySelector("["+RT+"]");
for(var n=e.target;n&&n!==b;n=n.parentNode){
if(n.getAttribute&&n.getAttribute(RT)!==null){location.reload();return}
if(!x&&n.tagName==="BUTTON"){location.reload();return}}},true)}
var r=root();
if(r&&window.MutationObserver){new MutationObserver(function(){if(booted())hide()}).observe(r,{childList:true})}
setTimeout(function(){show(${JSON.stringify(BOOT_CODES.stall)})},G)}
if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",watch)}else{watch()}
})()`
}
