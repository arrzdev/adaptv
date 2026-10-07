import type {
  ComponentPropsWithRef,
  CSSProperties,
  MouseEvent,
  ReactNode,
} from "react"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import { useIsomorphicLayoutEffect } from "#adaptv/hooks/use-isomorphic-layout-effect"
import { useReducedMotion } from "#adaptv/hooks/use-reduced-motion"
import { composeStyles } from "#adaptv/utils/styles"

/* =============================================================================
 * Collapsible — a disclosure whose panel animates to a MEASURED height and stays
 * findable while closed.
 *
 * Two platform facts shape everything below.
 *
 * 1. `height: auto` cannot animate anywhere adaptv ships. `interpolate-size` /
 *    `calc-size()` are Chrome 129+ only and WebKit bug 295132 is new and unassigned
 *    (docs/decisions/animation.md §2). So the panel animates a measured pixel
 *    height and RESTS at `auto`: at rest there is no inline height at all, which is
 *    what lets content that grows later (an image that loads, a list that fetches)
 *    push the panel taller instead of being clipped at the height it opened to.
 *    The transition is a CSS transition rather than WAAPI because a CSS transition
 *    retargets from the current computed value for free; toggling mid-flight just
 *    sets the new target and the running transition turns around without a snap.
 *
 * 2. A closed panel is `hidden="until-found"`, not `display: none`. Chromium 102+
 *    (every Android WebView adaptv ships to is 119+) keeps the content in the
 *    find-in-page index and fires `beforematch` on it, then REMOVES the `hidden`
 *    attribute itself before scrolling to the match. WebKit on the iOS 18 floor has
 *    no such event and treats the value as plain `hidden`, so nothing is lost there.
 *    React 19.2's `renderToString` drops the string value (`<div hidden="">`), so the
 *    prop stays boolean and the value is upgraded to `until-found` in a layout effect
 *    after mount, and reconciled on every commit so a browser-side removal that a
 *    controlled owner refuses is put back.
 * ============================================================================= */

type CollapsibleContextValue = {
  isOpen: boolean
  isDisabled: boolean
  setOpen: (next: boolean) => void
  toggle: () => void
  triggerId: string
  panelId: string
  registerTriggerId: (id: string | undefined) => void
  registerPanelId: (id: string | undefined) => void
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(
  null,
)

function useCollapsibleContext(): CollapsibleContextValue {
  const ctx = useContext(CollapsibleContext)
  if (!ctx) {
    throw new Error("useCollapsible must be used within <Collapsible>.")
  }
  return ctx
}

/**
 * Programmatic state from {@link useCollapsible} for Tier 2 branch paint. The
 * same state is on the DOM as presence attributes (`data-collapsible-open`,
 * `data-disabled`) for a class-only branch; see {@link Collapsible}.
 */
export type CollapsibleState = {
  isOpen: boolean
  isDisabled: boolean
  setOpen: (next: boolean) => void
  /** No-op while disabled. */
  toggle: () => void
}

/**
 * Reactive open state for {@link Collapsible} compound trees. Branch on
 * `isOpen` / `isDisabled` inside a `Collapsible.Trigger` or `Collapsible.Panel`
 * wrapper, or drive it from a custom control with `setOpen` / `toggle`.
 */
export function useCollapsible(): CollapsibleState {
  const { isOpen, isDisabled, setOpen, toggle } = useCollapsibleContext()
  return useMemo(
    () => ({ isOpen, isDisabled, setOpen, toggle }),
    [isOpen, isDisabled, setOpen, toggle],
  )
}

/**
 * Props for the root {@link Collapsible}. Controlled: `open` + `onOpenChange`.
 * Uncontrolled: `defaultOpen`. Other `<div>` props land on the root element.
 */
export type CollapsibleProps = Omit<
  ComponentPropsWithRef<"div">,
  "className" | "style" | "children"
> & {
  /** Controlled open state (with {@link CollapsibleProps.onOpenChange}). */
  open?: boolean
  /** Uncontrolled initial state. */
  defaultOpen?: boolean
  /**
   * Fired with the next open value on every request to change it: a trigger
   * press, a `useCollapsible().setOpen`, or find-in-page revealing the closed
   * panel. A controlled owner that ignores the call keeps the panel where it is.
   */
  onOpenChange?: (open: boolean) => void
  /** Disables the trigger (and `toggle`); the panel keeps its current state. */
  disabled?: boolean
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

/**
 * Disclosure root. Compose `Collapsible.Trigger` and `Collapsible.Panel`.
 *
 * The panel animates its measured height open and closed, rests at `height: auto`
 * so later growth is never clipped, and is `hidden="until-found"` while closed so
 * find-in-page still reaches the text inside it.
 *
 * Its state is spelled as PRESENCE attributes, per docs/decisions/styling.md §3.1:
 * `data-collapsible-open` on the root, the trigger and the panel while open and
 * absent while closed; `data-disabled` on the root and the trigger while disabled,
 * next to the native `disabled` on the button. A Tier 2 class therefore branches
 * with the bare Tailwind v4 variants — `data-collapsible-open:` on the part itself,
 * `group-data-collapsible-open:` from a descendant of a root that carries `group` —
 * and never on a value. The name is namespaced per component so a second adaptv
 * trigger composed onto the same element cannot overwrite it.
 *
 * @example
 * ```tsx
 * <Collapsible>
 *   <Collapsible.Trigger className="...">Details</Collapsible.Trigger>
 *   <Collapsible.Panel>
 *     <div className="p-4">...</div>
 *   </Collapsible.Panel>
 * </Collapsible>
 * ```
 */
function Collapsible({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  disabled,
  className,
  style,
  children,
  ...divProps
}: CollapsibleProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen
  const isDisabled = Boolean(disabled)

  //A consumer `id` on a part wins, and the aria wiring has to follow it: the
  //parts report their resolved id up so the OTHER part can point at it.
  const baseId = useId()
  const [triggerIdOverride, registerTriggerId] = useState<
    string | undefined
  >(undefined)
  const [panelIdOverride, registerPanelId] = useState<string | undefined>(
    undefined,
  )
  const triggerId = triggerIdOverride ?? `${baseId}-trigger`
  const panelId = panelIdOverride ?? `${baseId}-panel`

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  const toggle = useCallback(() => {
    if (isDisabled) return
    setOpen(!isOpen)
  }, [isDisabled, isOpen, setOpen])

  const contextValue = useMemo<CollapsibleContextValue>(
    () => ({
      isOpen,
      isDisabled,
      setOpen,
      toggle,
      triggerId,
      panelId,
      registerTriggerId,
      registerPanelId,
    }),
    [isOpen, isDisabled, setOpen, toggle, triggerId, panelId],
  )

  return (
    <CollapsibleContext.Provider value={contextValue}>
      <div
        data-adaptv="collapsible"
        data-part="root"
        //Presence attributes, not a `state="open|closed"` value
        //(docs/decisions/styling.md §3.1): namespaced per component so a second
        //adaptv trigger on the same element cannot overwrite it, and valueless so
        //Tailwind v4's bare `data-collapsible-open:` variant matches it.
        data-collapsible-open={isOpen ? "" : undefined}
        data-disabled={isDisabled ? "" : undefined}
        //No default rule and no lock, by decision: the root is a plain grouping
        //element with no neutral look of its own, so the consumer's classes are the
        //whole story (docs/decisions/styling.md §2).
        {...composeStyles({
          className,
          style,
        })}
        {...divProps}
      >
        {children}
      </div>
    </CollapsibleContext.Provider>
  )
}
Collapsible.displayName = "Collapsible"

export type CollapsibleTriggerProps = {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  /** Runs first; `preventDefault()` cancels the toggle. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  disabled?: boolean
  /** Wins over the generated id; `aria-labelledby` on the panel follows it. */
  id?: string
  "aria-label"?: string
}

function CollapsibleTrigger({
  children,
  className,
  style,
  onClick,
  disabled,
  id: idProp,
  ...props
}: CollapsibleTriggerProps) {
  const {
    isOpen,
    isDisabled,
    toggle,
    triggerId,
    panelId,
    registerTriggerId,
  } = useCollapsibleContext()
  const isTriggerDisabled = Boolean(disabled) || isDisabled

  useIsomorphicLayoutEffect(() => {
    registerTriggerId(idProp)
  }, [idProp, registerTriggerId])

  return (
    <button
      type="button"
      id={idProp ?? triggerId}
      data-adaptv="collapsible-trigger"
      data-part="trigger"
      data-collapsible-open={isOpen ? "" : undefined}
      //`data-disabled` verbatim (styling.md §3.1) beside the native attribute, so
      //a parent can style the disabled trigger without a `:disabled` reach-in.
      data-disabled={isTriggerDisabled ? "" : undefined}
      aria-expanded={isOpen}
      aria-controls={panelId}
      disabled={isTriggerDisabled || undefined}
      //No default rule and no lock, by decision (like Dropdown.Trigger): a trigger is
      //a plain button adaptv wires open/close onto, with no neutral look of its own.
      {...composeStyles({
        className,
        style,
      })}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        toggle()
      }}
      {...props}
    >
      {children}
    </button>
  )
}
CollapsibleTrigger.displayName = "Collapsible.Trigger"

export type CollapsiblePanelProps = {
  children?: ReactNode
  className?: string
  style?: CSSProperties
  /** Wins over the generated id; `aria-controls` on the trigger follows it. */
  id?: string
}

type PanelTransition = "open" | "close" | null

/**
 * Whether a CSS transition on `height` is live on the panel. `getAnimations()`
 * flushes pending style, so a transition the height write just started is already
 * visible here; and where the method is missing (happy-dom) there is nothing to
 * wait for, which is the honest answer rather than a timer.
 */
function hasRunningHeightTransition(panel: HTMLElement): boolean {
  if (typeof panel.getAnimations !== "function") return false
  return panel
    .getAnimations()
    .some(
      (animation) =>
        "transitionProperty" in animation &&
        (animation as CSSTransition).transitionProperty === "height" &&
        animation.playState !== "finished",
    )
}

/** Force the style just written to be the before-change style of the next write. */
function commitStyle(panel: HTMLElement): void {
  void panel.getBoundingClientRect()
}

/**
 * The content of a {@link Collapsible}. A `<div role="region">` labelled by the
 * trigger, `hidden="until-found"` while closed. Carries `data-collapsible-open`
 * while open and, while a height transition runs, `data-collapsible-opening` or
 * `data-collapsible-closing` — presence attributes (styling.md §3.1), so a
 * consumer's `data-collapsible-opening:` class needs no brackets.
 *
 * Put padding and borders on a CHILD of the panel, not on the panel itself: the
 * open animation starts from `height: 0px` on the panel's border box, and the
 * measured target is `scrollHeight`, which includes the panel's own padding but not
 * its border. Padding on the panel would be visible at the start of the open and
 * pop in at the end of the close; a border would be cut off by the measured height.
 */
function CollapsiblePanel({
  children,
  className,
  style,
  id: idProp,
}: CollapsiblePanelProps) {
  const { isOpen, setOpen, triggerId, panelId, registerPanelId } =
    useCollapsibleContext()
  const reducedMotion = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)

  useIsomorphicLayoutEffect(() => {
    registerPanelId(idProp)
  }, [idProp, registerPanelId])

  //The transition phase is derived DURING render from the change in `isOpen`, so
  //the commit that removes `hidden` is the same commit that carries
  //`data-collapsible-opening`: the panel is never displayed with the transition
  //rule off, which is what would let it paint at full height for a frame.
  const [prevOpen, setPrevOpen] = useState(isOpen)
  const [transition, setTransition] = useState<PanelTransition>(null)
  //Find-in-page has already revealed the content by the time the reveal lands here,
  //so that open is instant: animating from 0 would move the scroll target the
  //browser is about to scroll to.
  const [revealed, setRevealed] = useState(false)
  if (prevOpen !== isOpen) {
    setPrevOpen(isOpen)
    setTransition(
      reducedMotion || revealed ? null : isOpen ? "open" : "close",
    )
  }
  if (revealed) setRevealed(false)

  //`hidden` only once the close has settled; during the close the content must
  //stay displayed for the height to animate at all.
  const isClosedAtRest = !isOpen && transition === null

  //Per-commit reconcile of the DOM against the phase: the `hidden` value React
  //cannot render, the inline height the transition left behind, and the case
  //where the browser removed `hidden` for a match a controlled owner refused.
  useIsomorphicLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (isClosedAtRest) {
      if (panel.getAttribute("hidden") !== "until-found") {
        panel.setAttribute("hidden", "until-found")
      }
    } else if (panel.hasAttribute("hidden")) {
      panel.removeAttribute("hidden")
    }
    //At rest the panel is `height: auto`, so later growth is not clipped. Cleared
    //here, in the commit that also drops `data-collapsible-opening` /
    //`data-collapsible-closing`, so the px-to-auto jump happens with the
    //transition rule already off and never animates.
    if (transition === null && panel.style.height !== "") {
      panel.style.height = ""
    }
  })

  useIsomorphicLayoutEffect(() => {
    if (transition === null) return
    const panel = panelRef.current
    if (!panel) return

    //Mid-flight the computed height is already a px value the transition owns, so
    //only the new target is written and the running transition retargets from
    //where it is. Writing the start value in that case would end the running
    //transition (a `transitioncancel`) for nothing.
    const running = hasRunningHeightTransition(panel)
    if (transition === "open") {
      if (!running) {
        panel.style.height = "0px"
        commitStyle(panel)
      }
      //`scrollHeight` reads the full content height whatever the clipped box is at,
      //which is why the panel is `overflow: hidden` during the transition.
      panel.style.height = `${panel.scrollHeight}px`
    } else {
      if (!running) {
        //`auto` cannot be a transition start value, so pin the current px first.
        panel.style.height = `${panel.getBoundingClientRect().height}px`
        commitStyle(panel)
      }
      panel.style.height = "0px"
    }

    const settle = () => setTransition(null)

    //Nothing took: `prefers-reduced-motion`, a `0s` duration, a `display: none`
    //ancestor, or an environment without transitions. Settle now. There is
    //deliberately no timer fallback: a timer that fires under a still-running
    //transition is exactly the race the drawer once shipped.
    if (!hasRunningHeightTransition(panel)) {
      settle()
      return
    }

    const onTransitionSettled = (event: TransitionEvent) => {
      if (event.target !== panel || event.propertyName !== "height") return
      //A retarget ends the previous transition with a `transitioncancel` that is
      //dispatched a frame later, after the new one has started. Only an empty
      //animation list means this phase is over.
      if (hasRunningHeightTransition(panel)) return
      settle()
    }
    panel.addEventListener("transitionend", onTransitionSettled)
    panel.addEventListener("transitioncancel", onTransitionSettled)
    return () => {
      panel.removeEventListener("transitionend", onTransitionSettled)
      panel.removeEventListener("transitioncancel", onTransitionSettled)
    }
  }, [transition, isOpen])

  //Find-in-page reached the closed content. The browser removes `hidden` itself
  //right after this event; the state has to follow, or the next commit would hide
  //the match again. `setRevealed` forces that commit even when a controlled owner
  //refuses, so the reconcile above can restore `hidden` in that case.
  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const onBeforeMatch = (event: Event) => {
      if (event.target !== panel) return
      setRevealed(true)
      setOpen(true)
    }
    panel.addEventListener("beforematch", onBeforeMatch)
    return () => panel.removeEventListener("beforematch", onBeforeMatch)
  }, [setOpen])

  return (
    // biome-ignore lint/a11y/useSemanticElements: the panel element is a `<div>` by API contract; with `aria-labelledby` it is the same landmark a `<section>` would be, and the explicit role is what consumers and the e2e select on
    <div
      ref={panelRef}
      id={idProp ?? panelId}
      data-adaptv="collapsible-panel"
      data-part="panel"
      data-collapsible-open={isOpen ? "" : undefined}
      //The phase is two presence attributes, never both and neither at rest,
      //rather than one attribute carrying an `open|close` value (styling.md §3.1).
      data-collapsible-opening={transition === "open" ? "" : undefined}
      data-collapsible-closing={transition === "close" ? "" : undefined}
      role="region"
      aria-labelledby={triggerId}
      hidden={isClosedAtRest || undefined}
      //No lock, by decision: overflow and the transition live in collapsible.css
      //keyed on the opening/closing attributes, and the panel has no neutral look
      //beyond that.
      {...composeStyles({
        className,
        style,
      })}
    >
      {children}
    </div>
  )
}
CollapsiblePanel.displayName = "Collapsible.Panel"

const CollapsibleCompound = Object.assign(Collapsible, {
  Trigger: CollapsibleTrigger,
  Panel: CollapsiblePanel,
})

export { CollapsibleCompound as Collapsible }
