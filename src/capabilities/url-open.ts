//Links that open the app — a URL the OS hands to the installed native app becomes a
//route, exactly once, and the app hears about it after the navigation is asked for:
//  • native  → @capacitor/app `appUrlOpen`, installed by the router factory
//  • web/PWA → nothing: a link that opens a tab IS the document's own URL, and the
//              router already reads that
//
//The scheme itself is declared by `deepLinks.scheme` in `adaptv.config.ts`, which the
//CLI writes into both native projects. → `docs/guides/cookbook.md §7`
//
//## Why the app never calls `getLaunchUrl`
//
//A link that LAUNCHES the app reaches the page twice. The plugin retains the
//`appUrlOpen` event until a listener exists and replays it to the first one, AND
//`getLaunchUrl()` answers the same URL. Reading both navigates twice. `getLaunchUrl`
//is also the wrong question on both platforms: on iOS it answers the LAST URL the app
//was opened with, not the launch one, and on Android it never changes after launch,
//so a WebView reload (live reload, an update, a chunk reload) that re-read it would
//send the app back to a link the user followed long ago. The replayed event is the
//one delivery that is right on both, so it is the only one read.
//
//The replay goes to the FIRST listener only, which is why the listener is attached
//once, by the framework, as the router is built — a consumer subscribing later from a
//component would never see a cold-start link at all.
import { App } from "@capacitor/app"
import type { AnyRouter } from "@tanstack/react-router"
import { isNativePlatform } from "#adaptv/utils/platform"

/** What {@link onUrlOpened} hands a handler. */
export type UrlOpened = {
  /** The URL exactly as the OS delivered it — `myapp://settings?tab=2`. */
  url: string
  /** The in-app location it was routed to — `/settings?tab=2`. */
  path: string
}

const handlers = new Set<(opened: UrlOpened) => void>()

//The router the one listener navigates. Replaced rather than kept when the router is
//built again, so a rebuilt router (a hot update of the route tree) is the one that
//moves, without a second listener that would move the old one too.
let activeRouter: AnyRouter | null = null
let installed = false

//`addListener` is fire-and-forget at boot, so nothing would handle its rejection (a
//binary without the plugin, an OS error): it would reach `unhandledrejection` and every
//error reporter the app installed, on every cold launch. Without the listener a link
//still opens the app, at its first screen — the degraded answer.
const ignoreBridgeRejection = () => {}

/**
 * The in-app location for a URL the OS opened the app with, or `null` when it is not
 * a URL at all.
 *
 * A custom scheme has no origin to strip, so its host is the first path segment —
 * that is what the dev wrote when they typed `myapp://settings/x`, and it is how the
 * URL parser reads it (host `settings`, pathname `/x`). A web link keeps only its path,
 * query and fragment.
 */
function pathOf(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const tail = `${url.search}${url.hash}`
  if (url.protocol === "http:" || url.protocol === "https:") {
    return `${url.pathname}${tail}`
  }
  //`myapp:///settings` has an empty host and `myapp:settings` no slash at all; both
  //land on `/settings`, as `myapp://` lands on `/`
  const segments = `${url.hostname}${url.pathname}`.replace(/^\/+/, "")
  return `/${segments}${tail}`
}

function routeUrl(raw: unknown): void {
  const router = activeRouter
  if (!router || typeof raw !== "string") return
  const path = pathOf(raw)
  if (path === null) return
  //A link that arrives before the first screen has settled is the one that launched
  //the app, and it TAKES that entry rather than stacking on it: the screen the app
  //was about to show is not somewhere the user has been, so back must not return to
  //it. Once a screen has settled, a link is a navigation like any other.
  const replace = router.state.resolvedLocation === undefined
  //Before the provider mounts, nothing subscribes to the history yet, and a router
  //navigation then loads the route itself — which the mount's own load repeats, so the
  //linked route's beforeLoad and loader would run twice. Moving the history alone
  //leaves the one load to the mount, which reads the entry it finds.
  if (replace && router.history.subscribers.size === 0) {
    router.history.replace(path)
  } else {
    void router.navigate({ href: path, replace })
  }
  for (const handler of handlers) handler({ url: raw, path })
}

/**
 * Attach the one native link listener, and point it at `router`. Called by the router
 * factory on every build; the listener itself is attached once per page.
 *
 * Internal — deliberately not on the public surface: a second caller would be a second
 * router competing for the same links.
 */
export function installUrlOpen(router: AnyRouter): void {
  if (typeof window === "undefined" || !isNativePlatform()) return
  activeRouter = router
  if (installed) return
  installed = true
  //Never `.then` a value out of the plugin itself: a plugin object answers `then`, so a
  //promise resolved TO it never settles. The handle is all that comes back here.
  void App.addListener("appUrlOpen", (event) => {
    routeUrl(event?.url)
  }).catch(ignoreBridgeRejection)
}

/**
 * Run `handler` each time a link opens the app, after it has been routed. Returns an
 * unsubscribe.
 *
 * The app does not have to navigate — adaptv already did. This is for what a route
 * cannot do: analytics on the link, or finishing a sign-in whose callback came back
 * through the scheme. It hears links that arrive while it is subscribed; the link that
 * launched the app is routed before any component mounts, so read that one from the
 * route it landed on. Never fires on the web, where a link is simply the page's URL.
 */
export function onUrlOpened(
  handler: (opened: UrlOpened) => void,
): () => void {
  handlers.add(handler)
  return () => {
    handlers.delete(handler)
  }
}
