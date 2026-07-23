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
 * Open an external URL: the in-app system browser on native, a new tab on web.
 * Fire-and-forget (imperative → API). Safe to await if you want the native
 * browser's open to settle.
 */
export async function openExternal(url: string): Promise<void> {
  if (isNativePlatform()) {
    try {
      await Browser.open({ url })
      return
    } catch {
      //plugin unavailable — fall through to window.open
    }
  }
  if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer")
  }
}
