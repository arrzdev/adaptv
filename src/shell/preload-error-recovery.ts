/**
 * Recovery for the stale-chunk failure. → `docs/decisions/register.md` B3/B4, `docs/design/rendering.md §3.4`
 *
 * ## The failure this exists for
 *
 * A tab is open. A new build deploys. The user navigates to a route they haven't
 * visited, so the router lazily `import()`s its chunk — but that chunk's hashed
 * filename belongs to the *previous* build. The new service worker's precache no
 * longer lists it, and the host no longer serves it. The import rejects, and the
 * user gets a white screen with no path out.
 *
 * Vite emits a `vite:preloadError` event for exactly this, and this
 * module is the only thing in adaptv that listens for it.
 *
 * ## Why the guard is not optional, and why it expires
 *
 * The fix is to reload — the tab then picks up the new manifest and everything
 * resolves. But if the chunk is *genuinely* missing (a bad deploy, a host that
 * pruned the previous build), reloading cannot help, and an unguarded handler
 * spins the browser forever.
 *
 * So the reload is stamped with the time in `sessionStorage`, because the reload
 * itself wipes memory — an in-memory flag would reset on every attempt and guard
 * nothing. A stale chunk within {@link RECOVERY_WINDOW_MS} of that stamp means the
 * reload already happened and did not help. One outside it is a later deploy, and
 * gets its own reload: the stamp answers "did a recovery reload just happen", never
 * "has this tab ever recovered". A session-long guard answered the second question,
 * so a tab that recovered once went straight to the offline screen on the next
 * deploy, with no reload at all.
 */

const PRELOAD_ERROR_GUARD_KEY = "adaptv:preload-error-reload"

/**
 * How long after a recovery reload a stale chunk still counts as that reload not
 * having helped. 30 s.
 *
 * The chunk a reload failed to bring back fails again in the document the reload
 * produced as soon as that document asks for it: while it boots, or when a link to
 * it scrolls into view. Measured from the stamp to that second failure, behind a
 * 300 ms document round trip (the control in `e2e-sw/stale-chunk.spec.ts`, three
 * runs each): 0.55–0.57 s in Chromium, 0.53–0.67 s in WebKit, 1.1–1.2 s with
 * Chromium's CPU slowed 6×, and 2.6 s slowed 20×. The window has to outlast the
 * slowest device's boot by a wide margin, because the price of being short is a
 * reload every window for a chunk that is never coming back.
 *
 * The price of being long is a second deploy landing inside it, after a recovery
 * that worked: that tab gets the offline screen, whose retry reloads, instead of a
 * silent reload. Two deploys thirty seconds apart, both reaching the same open tab,
 * is the rarer of the two.
 */
export const RECOVERY_WINDOW_MS = 30_000

/**
 * The router's own reload net keys its loop guard by the failed import's message,
 * sets it once and never clears it. WebKit's message carries no URL ("Importing a
 * module script failed."), so there it is one key for the whole tab session, and
 * the second recovery in a tab reloaded with the router's error screen drawn over
 * it. adaptv clears these whenever it decides to reload, so the router can hold
 * that page still once more; the time window above is the loop guard for both.
 */
const ROUTER_RELOAD_KEY_PREFIX = "tanstack_router_reload:"

type Decision = "reload" | "reloading" | "unrecoverable"

/**
 * When THIS document last asked for a reload. Module scope, so it dies with the
 * document the reload replaces, and every installation shares one answer.
 *
 * The stamp alone cannot answer "is a reload already on its way": it is fresh the
 * instant this document reloads, so every later error here reads exactly like the
 * document a failed reload produced, and would draw the offline screen over a
 * recovery still in flight. Later errors are routine — a route that imports several
 * lazy modules concurrently fails each of them.
 *
 * Held for the same window rather than for good. A reload a `beforeunload` handler
 * cancelled never replaces this document, and neither does a restore from the
 * back/forward cache; left set, this document would ignore every stale chunk for the
 * rest of its life.
 */
let reloadRequestedAt: number | null = null

//Either side of `now`: a clock set back past a stamp must not keep it recent for
//good, and a stamp that is not a number is never recent.
function withinWindow(now: number, at: number): boolean {
  return Math.abs(now - at) < RECOVERY_WINDOW_MS
}

function decide(now: number): Decision {
  if (reloadRequestedAt !== null && withinWindow(now, reloadRequestedAt)) {
    return "reloading"
  }
  //Fails closed when storage is unavailable — Safari private mode and partitioned
  //third-party contexts both throw on access. Without storage there is no guard,
  //and the asymmetry is stark: failing closed costs the user one tap on the
  //offline screen's retry, failing open spins the browser indefinitely.
  try {
    const stamp = sessionStorage.getItem(PRELOAD_ERROR_GUARD_KEY)
    if (stamp !== null && withinWindow(now, Number(stamp))) {
      return "unrecoverable"
    }
    sessionStorage.setItem(PRELOAD_ERROR_GUARD_KEY, String(now))
    clearRouterReloadKeys()
    return "reload"
  } catch {
    return "unrecoverable"
  }
}

function clearRouterReloadKeys(): void {
  const keys: string[] = []
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index)
    if (key?.startsWith(ROUTER_RELOAD_KEY_PREFIX)) keys.push(key)
  }
  for (const key of keys) sessionStorage.removeItem(key)
}

/**
 * Install the `vite:preloadError` net. Returns a teardown function.
 *
 * adaptv's shell installs it once, with the offline screen as `onUnrecoverable`.
 * That callback fires when a recovery reload happened within the window and the
 * chunk is still missing — reloading again cannot help, and the offline UI beats a
 * blank page — or when there is no storage to guard a reload with.
 *
 * ## Why the reloading document leaves the error alone
 *
 * `event.preventDefault()` does not make a failed import go away: it stops Vite
 * rethrowing, and the import then RESOLVES — to `undefined`. The router reads a
 * component off that, throws, and the app's error boundary is drawn over the
 * reload while it is in flight (measured in Chromium: "Something went wrong" for
 * the reload's whole round trip). Left alone, Vite rethrows the import's own
 * error, and the router holds a missing-module error as a reload in progress and
 * draws nothing for it. (Vite goes on to dispatch an event per failed dependency
 * only while each one is cancelled; left alone, it rethrows at the first.) So the
 * net prevents the default only where it takes the failure over itself — the
 * unrecoverable case, which renders the offline screen — and every error in a
 * document that is already reloading, first or later, is left exactly as the
 * engine raised it.
 *
 * What that cannot reach, measured in `e2e-sw/stale-chunk.spec.ts`:
 *
 * - The router recognises the missing-module wordings, not every failure. WebKit
 *   behind a host that rewrites a missing chunk to the index — the `_redirects`
 *   adaptv's own `spa` build emits — rejects with a MIME-type error instead, and
 *   the router's error boundary is drawn over the reload there. Nothing an event
 *   listener does can hold the import pending, so that one is the router's.
 * - The net is armed by the shell's effect, after the first render. A document
 *   that imports a missing route chunk while it boots — the reload a tapped link
 *   produced lands on that route — fails before anything is listening, and gets
 *   the router's error screen rather than the offline one.
 */
export function installPreloadErrorRecovery(
  onUnrecoverable?: (error: unknown) => void,
): () => void {
  if (typeof window === "undefined") return () => {}

  const handler = (event: Event) => {
    const now = Date.now()
    const decision = decide(now)
    if (decision === "reloading") return
    if (decision === "reload") {
      reloadRequestedAt = now
      window.location.reload()
      return
    }
    event.preventDefault()
    onUnrecoverable?.((event as Event & { payload?: unknown }).payload)
  }

  window.addEventListener("vite:preloadError", handler)
  return () => window.removeEventListener("vite:preloadError", handler)
}
