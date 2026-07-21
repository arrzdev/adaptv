/**
 * The back-handler chain. → `COORDINATION.md §2`
 *
 * ## The problem
 *
 * `router.back()` alone is wrong. An open overlay must intercept back **before**
 * navigation — but a lone `router.back()` cannot know a drawer is open, and the
 * drawer cannot know a back press happened. Every actor is blind to the others,
 * so whoever happens to be wired up wins.
 *
 * An installed app makes it worse: there is no browser chrome and no URL bar, so
 * the app fully owns back, including a programmatic affordance.
 *
 * ## The shape
 *
 * A **module-level registry**, deliberately not React context: it has to be
 * reachable both from the eager `App.backButton` listener installed at boot (long
 * before any component tree exists) and from imperative code.
 *
 * The shell installs exactly **one** platform listener that walks handlers
 * high→low priority; the first to return `true` consumes the press, and anything
 * returning `false` defers to the next. The old `useAndroidBackButton` behaviour
 * (`canGoBack() ? back() : exitApp()`) becomes the *floor* of this chain rather
 * than the whole of it.
 */

/**
 * Priority bands. Numeric so an app can slot a handler between them, named so the
 * common cases don't have to invent numbers.
 */
export const BackPriority = {
  /** Drawers, modals, sheets — registered while open. Closes before anything navigates. */
  Overlay: 400,
  /** Menus, search fields, transient UI that should dismiss rather than navigate. */
  Transient: 300,
  /** In-app back affordance (a header back button). */
  Affordance: 200,
  /** Router history back. nativ's default floor handler. */
  RouterBack: 100,
  /** Exit the app. Only reachable when there is no history left. */
  ExitApp: 0,
} as const

/** Returns `true` to consume the back press, `false` to defer to the next handler. */
export type BackHandler = () => boolean

type Entry = {
  handler: BackHandler
  priority: number
  /** Registration order — breaks priority ties so the newest wins. */
  seq: number
}

const entries: Entry[] = []
let nextSeq = 0

/**
 * Register a back handler. Returns an unregister function.
 *
 * Ties are broken by **most-recently-registered first**: two stacked drawers
 * register in the same band, and the top one — mounted last — must close first,
 * or back closes the drawer underneath it.
 */
export function registerBackHandler(
  handler: BackHandler,
  priority: number = BackPriority.Transient,
): () => void {
  const entry: Entry = { handler, priority, seq: nextSeq++ }
  entries.push(entry)

  let removed = false
  return () => {
    //idempotent: an overlay may unregister on close AND on unmount
    if (removed) return
    removed = true
    const index = entries.indexOf(entry)
    if (index !== -1) entries.splice(index, 1)
  }
}

/**
 * Walk the chain. Returns `true` if a handler consumed the press.
 *
 * Iterates a **snapshot**, so a handler that registers or unregisters another
 * during the walk cannot be re-entered by the same press or cause an entry to be
 * skipped — a real hazard, since dismissing one overlay routinely mounts another.
 *
 * A throwing handler is caught and treated as "did not handle": a crashing
 * overlay must not wedge the back button for the entire app.
 */
export function runBackChain(): boolean {
  const ordered = [...entries].sort(
    (a, b) => b.priority - a.priority || b.seq - a.seq,
  )

  for (const entry of ordered) {
    try {
      if (entry.handler()) return true
    } catch {
      //treat a broken handler as a deferral rather than losing the press entirely
    }
  }
  return false
}

/** Test seam — drops every registration. */
export function resetBackChain(): void {
  entries.length = 0
}
