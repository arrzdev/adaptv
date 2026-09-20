//External navigation. An external URL (a scheme like http:/mailto:/tel: or a
//protocol-relative //) must leave the app's own routing: on native it opens the
//in-app system browser (@capacitor/browser — SFSafariViewController / Custom Tabs);
//on web a new tab. Internal route paths ("/settings") are NOT external — route them
//through the router (Link), not this.
import { Browser } from "@capacitor/browser"
import { isNativePlatform } from "#adaptv/utils/platform"

/**
 * Whether `href` points outside the app's client router — a URI scheme
 * (`http:`, `https:`, `mailto:`, `tel:`, …) or a protocol-relative `//host`.
 * A relative path (`/settings`, `settings`) is internal → `false`.
 */
export function isExternalUrl(href: string): boolean {
  if (href.startsWith("//")) return true
  return /^[a-z][a-z0-9+.-]*:/i.test(href)
}

/**
 * What happened. `"blocked"` is an ordinary outcome, not an error — the browser
 * refused the new tab (a popup blocker, usually because the call lost the click's
 * user activation) and the caller has to render something for it. `"invalid"` is
 * a URL that does not parse, or one whose scheme would run inside the app or
 * replace it instead of leaving it (`javascript:`, `data:`, `blob:`, `about:`,
 * `file:`). `"unsupported"` is the server, where there is no window to open
 * anything in.
 */
export type OpenExternalOutcome =
  | "opened"
  | "blocked"
  | "invalid"
  | "unsupported"

//these would execute in, or navigate, a document that belongs to the app
const REFUSED_SCHEMES = new Set([
  "javascript:",
  "data:",
  "blob:",
  "about:",
  "file:",
])

/**
 * Open an external URL: the in-app system browser on native, a new tab on web.
 * Resolves to what happened and never rejects.
 *
 * Only `http:` and `https:` open a browser. Any other scheme (`mailto:`, `tel:`,
 * an app's own) is handed to the system by assigning `location`: both native
 * shells cancel that navigation and pass the URL to the OS, and a browser
 * launches the scheme's handler and stays on the page. It resolves `"opened"`
 * there, which means handed over, not delivered. The in-app browser cannot
 * take those schemes, and falling through to `window.open` in a WebView reports
 * a `"blocked"` that is not true. On a native build whose in-app browser plugin
 * is missing, an http(s) URL is handed over the same way.
 *
 * On web it reaches `window.open` before its first `await`, so calling it
 * straight from a click handler keeps the user activation a popup blocker checks
 * for. The tab is opened at `about:blank` WITHOUT `noopener` or `noreferrer`,
 * because either feature makes `window.open` return `null` even on success,
 * the same value a blocker returns. Its `opener` is then severed, and it is
 * carried to the URL by an anchor clicked inside its own document. The request
 * is then made by that blank document, whose `about:blank` URL is never sent as
 * a Referer, instead of by the app's, whose policy may send the full URL (a
 * `location` assignment from here would still count as the app's navigation).
 * The anchor's `rel="noreferrer"` repeats the guarantee rather than making it.
 */
export async function openExternal(
  url: string,
): Promise<OpenExternalOutcome> {
  if (typeof window === "undefined") return "unsupported"
  const target = resolve(url)
  if (!target || REFUSED_SCHEMES.has(target.protocol)) return "invalid"
  if (target.protocol !== "http:" && target.protocol !== "https:")
    return handOver(target.href)
  if (isNativePlatform()) {
    try {
      await Browser.open({ url: target.href })
      return "opened"
    } catch {
      //The plugin is missing from the binary. A tab is not the way out of a
      //WebView: iOS hands the OS the tab's own `about:blank` instead of the URL,
      //and Android has no second window to open. The shell's own navigation
      //policy sends a foreign URL to the system browser, as it does mailto:.
      return handOver(target.href)
    }
  }
  return openTab(target.href)
}

/** Give the URL to the system by navigating to it; see {@link openExternal}. */
function handOver(href: string): OpenExternalOutcome {
  window.location.href = href
  return "opened"
}

/**
 * Parse the way `window.open` would, relative to the page, but without its
 * `SyntaxError`. A protocol-relative `//host` takes `https:` when the page itself
 * is not on http(s): a native shell's `capacitor://` would otherwise hand the
 * browser a URL nothing can load.
 */
function resolve(url: string): URL | null {
  const onHttp = /^https?:$/.test(window.location.protocol)
  try {
    return url.startsWith("//") && !onHttp
      ? new URL(`https:${url}`)
      : new URL(url, window.location.href)
  } catch {
    return null
  }
}

function openTab(href: string): OpenExternalOutcome {
  const tab = window.open("about:blank", "_blank")
  if (!tab) return "blocked"
  tab.opener = null
  try {
    const document = tab.document
    const link = document.createElement("a")
    link.href = href
    link.rel = "noreferrer"
    ;(document.body ?? document.documentElement).append(link)
    link.click()
    return "opened"
  } catch {
    //a tab that cannot be navigated without the app's Referer is not opened
    tab.close()
    return "blocked"
  }
}
