import { Button } from "#adaptv/components/button"
import { View } from "#adaptv/components/view"
import { cn } from "#adaptv/utils/cn"

/**
 * Props for the offline UI. **Every one is optional**, and that is the design:
 * the same component is rendered from two places with different amounts of
 * context. → `RENDERING.md §3.1.2`
 *
 * | Rendered by | When | `onRetry` |
 * |---|---|---|
 * | **adaptv** | the app can't boot far enough for a route to exist — a route chunk fails (`vite:preloadError`), or the route tree can't resolve | defaults to `location.reload()` |
 * | **the consumer** | the route mounted fine but its *data* is unavailable | whatever refetches — `refetch`, a mutation, a router invalidate |
 */
export type OfflineProps = {
  /** Recovery action. Defaults to a full reload, which is all adaptv can do. */
  onRetry?: () => void
  /** The failure, when there was one. Never rendered by default — see below. */
  error?: unknown
  title?: string
  description?: string
  retryLabel?: string
  className?: string
}

/**
 * The default offline UI — themed, safe-area-aware, and part of the app.
 *
 * ## Why this is a component and not an `offline.html`
 *
 * A static HTML file would have its own markup, its own styling, no access to the
 * design system, no theme awareness, no safe-area handling, and would drift from
 * the app forever. Worse, it could only ever exist on **web** — the native target
 * has no service worker to serve it, so the same product behaviour would need a
 * second implementation. Mechanisms belong at the JS layer; the platform layer
 * stays dumb. (Same move adaptv already made for the splash screen.)
 *
 * ## Why it renders in place rather than redirecting to `/offline`
 *
 * A redirect destroys the URL and the route params, so retry can't reconstruct the
 * request; it adds a history entry; and it discards scroll and layout chrome. In
 * place, the route keeps `/product/xxx`, re-runs its own loader when connectivity
 * returns, and swaps to real content with **no navigation at all**. It also allows
 * per-route judgement — a product page can show cached data with a banner while
 * checkout hard-blocks — which one global offline screen cannot.
 *
 * Consumers override this wholesale via `offlineComponent` in `adaptv.config.ts`.
 */
export function Offline({
  onRetry,
  error,
  title = "You're offline",
  description = "Check your connection and try again.",
  retryLabel = "Try again",
  className,
}: OfflineProps) {
  const handleRetry = () => {
    if (onRetry) {
      onRetry()
      return
    }
    //adaptv's own call site: the app never booted, so there is nothing to refetch
    //and a reload is the only meaningful recovery available.
    location.reload()
  }

  //`error` is accepted but deliberately NOT rendered: it routinely carries a
  //request URL, a token, or a stack, and this screen is the one users screenshot
  //into support tickets. It exists so an app can log or conditionally surface it.
  void error

  return (
    <View
      safe="all"
      role="alert"
      aria-live="polite"
      className={cn(
        "flex min-h-0 flex-1 w-full flex-col items-center justify-center gap-3 px-6 text-center",
        className,
      )}
    >
      <h1 className="text-gray-950">{title}</h1>
      <p className="text-gray-600">{description}</p>
      <Button haptic onClick={handleRetry}>
        <Button.Text>{retryLabel}</Button.Text>
      </Button>
    </View>
  )
}
