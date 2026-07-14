import { Link as RouterLink, useRouter } from "@tanstack/react-router"
import type { MouseEvent, ReactNode } from "react"
import { forwardRef, useEffect } from "react"
import { isExternalUrl } from "#nativ/capabilities/browser"
import { ExternalLink } from "#nativ/components/external-link"
import { useGestureEngine } from "#nativ/hooks/use-gesture-engine"
import { cn } from "#nativ/utils/cn"

/* =============================================================================
 * TYPES
 * ============================================================================= */

//a press held past this is read as a hold, not a tap, and does not navigate
const HOLD_THRESHOLD_MS = 300

export interface LinkProps {
  to: string
  params?: Record<string, string>
  search?: Record<string, unknown>
  className?: string
  children: ReactNode
  disabled?: boolean
  /**
   * Treat this link as a "back" affordance: on a plain click, if going back in
   * history lands on `to`, pop (`history.back`) instead of pushing a duplicate
   * entry — so it shares one stack with the OS edge gesture instead of looping.
   * Stays a real `<a href>` (SEO, ⌘-click, preload all intact); only a plain
   * left-click is intercepted. Falls back to a normal push when it can't confirm
   * the back target (deep-link / hard reload). @default false
   */
  smartBack?: boolean
}

/* =============================================================================
 * CLASSES
 * ============================================================================= */

const LINK_ROOT_SURFACE_CLASS = "text-gray-950 no-underline"
const LINK_ROOT_INTERACTION_CLASS = "clickable"
const LINK_ROOT_NON_INTERACTION_CLASS = "non-clickable"
const LINK_ROOT_LAYOUT_CLASS = "text-left"

/* =============================================================================
 * SMART BACK
 * ============================================================================= */

type AppRouter = ReturnType<typeof useRouter>

//the browser won't reveal the previous entry's URL, so record each visited
//pathname keyed by its history index (TanStack's __TSR_index). a smartBack link
//consults this to decide pop-vs-push. one module-level subscription, app lifetime.
const indexToPathname = new Map<number, string>()
let trackerStarted = false

function historyIndexOf(state: unknown): number | undefined {
  const index = (state as { __TSR_index?: number } | null)?.__TSR_index
  return typeof index === "number" ? index : undefined
}

function startNavigationTracker(router: AppRouter) {
  if (trackerStarted) return
  trackerStarted = true

  const here = router.state.location
  const hereIndex = historyIndexOf(here.state)
  if (hereIndex !== undefined)
    indexToPathname.set(hereIndex, here.pathname)

  router.subscribe("onResolved", ({ toLocation }) => {
    const index = historyIndexOf(toLocation.state)
    if (index !== undefined)
      indexToPathname.set(index, toLocation.pathname)
  })
}

//true when stepping one entry back lands exactly on `pathname`
function backLandsOn(router: AppRouter, pathname: string): boolean {
  const index = historyIndexOf(router.state.location.state)
  if (index === undefined) return false
  return indexToPathname.get(index - 1) === pathname
}

/* =============================================================================
 * ROOT
 * ============================================================================= */

//arms the engine's long-press path so a stationary hold cancels the tap; the
//handler is a no-op — we only want the "held, so don't navigate" side effect
function noop() {}

/**
 * TanStack Router `Link` (`<a href>`) with tap-vs-scroll/hold discrimination via
 * {@link useGestureEngine}. A clean tap navigates natively; a press that scrolls,
 * is cancelled, or is held past {@link HOLD_THRESHOLD_MS} has its trailing click
 * swallowed by the engine so it never navigates.
 *
 * The iOS long-press link preview is suppressed in CSS (`-webkit-touch-callout:
 * none` on `a[href]`), not here. Use `<button>` + `router.navigate()` for
 * imperative handlers, not `Link`.
 */
export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
  {
    to,
    params,
    search,
    className,
    children,
    disabled = false,
    smartBack = false,
  },
  ref,
) {
  const router = useRouter()
  const gestureEngineHandlers = useGestureEngine({
    disabled,
    longPressThreshold: HOLD_THRESHOLD_MS,
    onLongPressUp: noop,
  })

  //record navigation history so smartBack can answer "does back land on `to`?".
  //idempotent — only the first mounted Link installs the subscription.
  useEffect(() => {
    startNavigationTracker(router)
  }, [router])

  //the anchor navigates natively (RouterLink's own click); the engine only
  //discriminates the gesture. its onClickCapture swallows the trailing click of a
  //moved / cancelled / held press in the capture phase, leaving a clean tap to
  //navigate. we override the engine's onClick — which preventDefaults every click
  //and would kill navigation — with a disabled-only guard.
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (disabled) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (!smartBack) return
    //leave modified / non-primary clicks to their native (new-tab) behavior
    if (
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return
    }
    //pop instead of pushing a duplicate when back lands on this link's target
    if (router.history.canGoBack() && backLandsOn(router, to)) {
      e.preventDefault()
      router.history.back()
    }
  }

  //external destination → hand off to the system browser (in-app on native, new tab
  //on web). The gesture / smartBack machinery above only applies to in-app routes.
  if (isExternalUrl(to)) {
    return (
      <ExternalLink
        ref={ref}
        href={to}
        className={className}
        aria-disabled={disabled || undefined}
      >
        {children}
      </ExternalLink>
    )
  }

  return (
    <RouterLink
      ref={ref}
      to={to}
      params={params}
      search={search}
      draggable={false}
      {...gestureEngineHandlers}
      onClick={handleClick}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      className={cn(
        LINK_ROOT_LAYOUT_CLASS,
        LINK_ROOT_SURFACE_CLASS,
        disabled
          ? LINK_ROOT_NON_INTERACTION_CLASS
          : LINK_ROOT_INTERACTION_CLASS,
        className,
      )}
    >
      {children}
    </RouterLink>
  )
})

Link.displayName = "Link"
