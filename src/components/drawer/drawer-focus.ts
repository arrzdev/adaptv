import type { RefObject } from "react"
import { useEffect, useLayoutEffect, useRef } from "react"

/*
 * The keyboard half of `role="dialog" aria-modal="true"` (WAI-ARIA APG, dialog pattern): focus
 * moves into the sheet on open, Tab and Shift+Tab stay inside it, Escape closes it, and focus
 * goes back to what opened it on close.
 *
 * The return target is recorded by the root BEFORE its open path blurs the active element
 * (DrawerTree.triggerOpenLifecycle); that blur, with nothing to undo it, is what used to leave
 * focus on <body> for the whole life of the sheet. It is the active element and not a
 * Drawer.Trigger because most sheets are opened by a plain button driving a controlled `open`.
 */

//every element that can take focus from the keyboard; the filter below drops what can't now
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "iframe",
  "summary",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]",
].join(",")

/**
 * The panel's Tab stops, in DOM order. Deliberately layout-free (no `offsetParent`, no rects):
 * the panel is translated off-screen while it opens, and jsdom has no layout at all.
 */
export function getTabbables(panel: HTMLElement): HTMLElement[] {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLButtonElement).disabled &&
      !el.closest("[inert], [hidden], [aria-hidden='true']"),
  )
}

/*
 * Open drawers, oldest first. Only the last one answers Tab and Escape: a nested sheet portals
 * next to its parent, not inside it, so the parent's trap would pull focus out of it, and one
 * Escape must close one level. Same rule as the back chain (BackPriority.Overlay, newest first),
 * and for the same reason it is pushed when a drawer OPENS, not when it mounts.
 */
const openStack: object[] = []

//input types that bring up the on-screen keyboard when focused
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
])

function isTextEntry(el: HTMLElement) {
  if (el.isContentEditable || el instanceof HTMLTextAreaElement)
    return true
  return (
    el instanceof HTMLInputElement && !NON_TEXT_INPUT_TYPES.has(el.type)
  )
}

function focusQuietly(el: HTMLElement) {
  //the panel is mid-slide when this runs; letting the browser scroll a translated element
  //"into view" moves the page or the scroller under it
  el.focus({ preventScroll: true })
}

type DrawerFocusOptions = {
  open: boolean
  /** The panel is committed (the engine's `mounted`, and the portal it renders into). */
  panelReady: boolean
  panelRef: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  requestClose: () => void
}

export function useDrawerFocus({
  open,
  panelReady,
  panelRef,
  returnFocusRef,
  requestClose,
}: DrawerFocusOptions) {
  const requestCloseRef = useRef(requestClose)
  requestCloseRef.current = requestClose

  //Initial focus, once the panel is in the document. A field React's `autoFocus` (or the
  //engine's reopen [data-autofocus] pass) already focused is inside the panel and is left alone.
  //A text field is only ever focused when the consumer marked it [data-autofocus]: as the first
  //Tab stop it would put the phone keyboard up on a sheet that never asked for it, so the panel
  //takes focus instead and the field is one Tab away.
  useEffect(() => {
    if (!open || !panelReady) return
    const panel = panelRef.current
    if (!panel || panel.contains(document.activeElement)) return
    const autofocus = panel.querySelector<HTMLElement>("[data-autofocus]")
    if (autofocus) {
      autofocus.focus()
      return
    }
    const first = getTabbables(panel)[0]
    focusQuietly(first && !isTextEntry(first) ? first : panel)
  }, [open, panelReady, panelRef])

  useEffect(() => {
    if (!open) return
    const token = {}
    openStack.push(token)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || openStack.at(-1) !== token) return
      const panel = panelRef.current
      if (!panel) return

      if (event.key === "Escape") {
        if (event.isComposing) return
        event.preventDefault()
        requestCloseRef.current()
        return
      }

      if (
        event.key !== "Tab" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return
      const tabbables = getTabbables(panel)
      const first = tabbables[0]
      const last = tabbables.at(-1)
      const active = document.activeElement
      if (!first || !last) {
        event.preventDefault()
        focusQuietly(panel)
        return
      }
      if (!(active instanceof Node) || !panel.contains(active)) {
        //a Tab that starts behind the sheet (the backdrop, a click on the page) comes back in
        event.preventDefault()
        focusQuietly(event.shiftKey ? last : first)
        return
      }
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault()
        focusQuietly(last)
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        focusQuietly(first)
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      const index = openStack.indexOf(token)
      if (index !== -1) openStack.splice(index, 1)
    }
  }, [open, panelRef])

  //Focus return, the commit `open` turns false: the panel is aria-hidden from that commit on,
  //so focus must not wait for the exit animation. Only when focus is still in the sheet or was
  //dropped to <body> by the close path's blur; a close that moved focus elsewhere on purpose
  //(a link that navigates, a field on the page) keeps it there.
  const wasOpenRef = useRef(open)
  useLayoutEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = open
    if (open || !wasOpen) return
    const target = returnFocusRef?.current
    if (returnFocusRef) returnFocusRef.current = null
    if (!target?.isConnected) return
    const active = document.activeElement
    const panel = panelRef.current
    if (
      active === null ||
      active === document.body ||
      panel?.contains(active) === true
    ) {
      focusQuietly(target)
    }
  }, [open, panelRef, returnFocusRef])
}
