//Native keyboard accessor. On a Capacitor build the OS reports the keyboard with
//EXACT height + will-show/will-hide events — none of the web visualViewport
//heuristics (dismiss/height confirms, field-switch transient filtering) are needed.
//On iOS resize mode is set to `None` so the OS doesn't push the webview; adaptv lifts
//content itself from the reported height (matching the web path — see the
//suppress-native-then-reimplement rule).
//
//The listeners are attached ONCE, app-wide, and eagerly (see initNativeKeyboard).
//`Keyboard.addListener` resolves its handle asynchronously (a bridge round-trip),
//so a per-consumer, lazy `addListener` on drawer-open loses the race against an
//[autofocus] field: the field focuses in the same commit and the OS fires
//`keyboardWillShow` BEFORE the handle is registered — the event is missed and the
//sheet never lifts. A single app-lifetime subscription set up at startup is always
//live by the time any drawer opens, so autofocus and tap-to-focus behave the same.
import { Keyboard, KeyboardResize } from "@capacitor/keyboard"
import { getOS, isNativePlatform } from "#adaptv/utils/platform"

export type KeyboardInfo = {
  isOpen: boolean
  /** The keyboard's own height in px (0 when closed). */
  height: number
  /**
   * px of the keyboard the layout viewport has NOT already given up for it:
   * `max(0, height - (restInnerHeight - innerHeight))`. Equals `height` wherever the layout
   * viewport keeps its size for the keyboard, which is every target but Android native.
   */
  unpaidHeight: number
  /**
   * `true` where the layout viewport itself shrinks for the keyboard (Android native), so the
   * keyboard's top edge is `innerHeight - unpaidHeight` in layout coordinates and the visual
   * viewport measures nothing about it.
   */
  resizesLayoutViewport: boolean
}

type Listener = (info: KeyboardInfo) => void

let current: KeyboardInfo = {
  isOpen: false,
  height: 0,
  unpaidHeight: 0,
  resizesLayoutViewport: false,
}
/** Hears a keyboard event from the OS (and the current state on subscribe, when open). */
const reportListeners = new Set<Listener>()
/** Hears a resize that changed only what the layout viewport has paid, never an OS event. */
const paymentListeners = new Set<() => void>()
let attached = false

function emitReport(isOpen: boolean, height: number): void {
  current = { isOpen, height, ...measureKeyboardPayment(height) }
  for (const listener of reportListeners) listener(current)
}

function emitPayment(): void {
  current = { ...current, ...measureKeyboardPayment(current.height) }
  for (const listener of paymentListeners) listener()
}

/*
 * The Android WebView pays for the keyboard itself: Capacitor 8's `SystemBars` pads it by the IME
 * inset, so `innerHeight` drops by the keyboard's height (measured on a Pixel 10 emulator: 923 →
 * 587 under a 336px keyboard, `virtualKeyboard.overlaysContent` true throughout) while the plugin
 * still reports the whole 336. iOS runs `KeyboardResize.None` and gives up nothing. What the page
 * must still answer is the part not yet paid, so this module remembers the layout viewport's
 * height at rest, app-wide, from boot: a component that mounts under an open keyboard has no rest
 * of its own to measure against.
 *
 * Kept per `innerWidth`, the key `keyboard-height-cache.ts` already uses: width moves with a
 * rotation or a window resize, so each keeps the rest it last had with no keyboard up. A resize
 * becomes the rest only while the keyboard is closed and no field that raises it holds focus —
 * the WebView's resize lands before the plugin's event as often as after it (both orders
 * measured), and in that gap the focused field is the only sign the shrink is the keyboard's.
 * Any other resize can only raise the rest, because a keyboard never makes the viewport taller.
 */
const restHeightByWidth = new Map<number, number>()

function layoutViewportResizesForKeyboard(): boolean {
  return isNativePlatform() && getOS() === "android"
}

//Input types that raise NO keyboard — mirrors use-keyboard's willOpenVirtualKeyboard. A local
//copy, as in keyboard-height-cache.ts: use-keyboard imports this module, so a back-import cycles.
const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "image",
  "button",
  "submit",
  "reset",
])

/** Whether the focused element, looked for inside open shadow roots, would raise a keyboard. */
function keyboardFieldHasFocus(): boolean {
  let active: Element | null = document.activeElement
  while (active?.shadowRoot?.activeElement) {
    active = active.shadowRoot.activeElement
  }
  return (
    (active instanceof HTMLInputElement &&
      !NON_TEXT_INPUT_TYPES.has(active.type)) ||
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLElement && active.isContentEditable)
  )
}

function rememberRestHeight(): void {
  const width = window.innerWidth
  const height = window.innerHeight
  const known = restHeightByWidth.get(width)
  if (!current.isOpen && !keyboardFieldHasFocus()) {
    restHeightByWidth.set(width, height)
  } else if (known !== undefined && height > known) {
    restHeightByWidth.set(width, height)
  }
}

/**
 * The unpaid part of a keyboard `keyboardHeight` tall, given the layout viewport's rest height
 * for this width (`undefined` when none was seen with the keyboard down) and its height now.
 * Floored at 0 both ways. An unknown rest counts as paid in full: only a width first reached with
 * the keyboard already up has none, and a WebView that shrinks for the keyboard has, by then,
 * shrunk.
 */
function resolveUnpaidKeyboardHeight({
  keyboardHeight,
  restHeight,
  viewportHeight,
}: {
  keyboardHeight: number
  restHeight: number | undefined
  viewportHeight: number
}): number {
  if (keyboardHeight <= 0 || restHeight === undefined) return 0
  const paid = Math.max(0, restHeight - viewportHeight)
  return Math.max(0, keyboardHeight - paid)
}

/**
 * What the layout viewport has paid for a keyboard `height` tall, right now: its unpaid part and
 * whether this viewport resizes for the keyboard at all. Off Android native the unpaid part is
 * `height` itself. Internal to the keyboard signal — `useKeyboard` completes its predicted and
 * held heights with it.
 */
export function measureKeyboardPayment(
  height: number,
): Pick<KeyboardInfo, "unpaidHeight" | "resizesLayoutViewport"> {
  if (!layoutViewportResizesForKeyboard()) {
    return { unpaidHeight: height, resizesLayoutViewport: false }
  }
  return {
    unpaidHeight: resolveUnpaidKeyboardHeight({
      keyboardHeight: height,
      restHeight: restHeightByWidth.get(window.innerWidth),
      viewportHeight: window.innerHeight,
    }),
    resizesLayoutViewport: true,
  }
}

/**
 * Attach the app-lifetime native keyboard listeners (idempotent, native only).
 * Called eagerly from the shell at startup so the listeners are live well before
 * any [autofocus] drawer can open — never lazily per consumer, which races the
 * async listener registration against the immediate keyboard raise.
 */
export function initNativeKeyboard(): void {
  if (attached || !isNativePlatform()) return
  attached = true
  //don't let the OS resize/push the webview — we lift content ourselves. Resize mode
  //only exists on iOS: the Android plugin answers `setResizeMode` with
  //`call.unimplemented()`, and Android's keyboard is the WebView's own window resize.
  //The call is a promise, so a failure arrives as a rejection (never a throw) and is
  //dropped here — height reporting below works without it.
  if (getOS() === "ios") {
    void Keyboard.setResizeMode({ mode: KeyboardResize.None }).catch(
      () => {},
    )
  }
  //never removed — keyboard visibility is an app-global concern, so the handles are
  //not kept and a subscriber leaving early has nothing to orphan. A registration
  //that rejects (plugin missing from the binary, an OS error) is dropped the same
  //way: consumers then simply never hear a keyboard event.
  void Keyboard.addListener("keyboardWillShow", (info) =>
    emitReport(true, info.keyboardHeight),
  ).catch(() => {})
  void Keyboard.addListener("keyboardWillHide", () =>
    emitReport(false, 0),
  ).catch(() => {})
  //Where the WebView pays for the keyboard: seed the rest at boot, before any keyboard can be
  //up, and tell the payment channel on every resize so the unpaid part follows the viewport in
  //whichever order the resize and the plugin's event arrive. A resize is never a report: the OS
  //may send the same height twice (a field switch, a hide during a prediction), and a consumer
  //must still see both. App-lifetime, like the listeners above.
  if (layoutViewportResizesForKeyboard()) {
    rememberRestHeight()
    window.addEventListener("resize", () => {
      rememberRestHeight()
      emitPayment()
    })
  }
}

/** Whether native keyboard events (exact height + will-show/hide) are available. */
export function hasNativeKeyboard(): boolean {
  return isNativePlatform()
}

/**
 * Subscribe to the native keyboard. Registration is synchronous (it only adds to
 * the app-wide listener set, whose OS listeners were attached at startup), so an
 * [autofocus] field's immediate `keyboardWillShow` is never missed. The current
 * state is delivered synchronously on subscribe when the keyboard is already up
 * (e.g. a drawer reopening under a still-raised keyboard). Returns an unsubscribe.
 * No-op off native.
 *
 * On Android native `cb` also hears every window resize, with the last report's
 * `isOpen` and `height` unchanged and a new `unpaidHeight`: the WebView shrinks by
 * the keyboard, so what it has paid moves while the OS says nothing. An unchanged
 * `{ isOpen, height }` is therefore no sign of a new keyboard event. Read
 * `unpaidHeight` as a best estimate: a width first reached with the keyboard up
 * counts as paid, window growth while the keyboard is up (a system bar hiding, a
 * split-screen divider) reads as keyboard until it closes, and a field focused in
 * a closed shadow root or an iframe cannot stop a resize that lands first from
 * passing for the rest (docs/design/keyboard-signal.md §3).
 */
export function subscribeNativeKeyboard(cb: Listener): () => void {
  return listenNativeKeyboard({
    onReport: cb,
    onPaymentChange: () => cb(current),
  })
}

/**
 * {@link subscribeNativeKeyboard} with the two sources apart: `onReport` hears only
 * the OS (and the current state on subscribe, when open), `onPaymentChange` only a
 * resize that moved the unpaid part, which {@link measureKeyboardPayment} reads.
 * Internal to the keyboard signal — `useKeyboard` needs every OS report to reach its
 * prediction and cache, including one that repeats the last.
 */
export function listenNativeKeyboard({
  onReport,
  onPaymentChange,
}: {
  onReport: Listener
  onPaymentChange: () => void
}): () => void {
  if (!isNativePlatform()) return () => {}
  //defensive: normally the shell has already initialised at startup
  initNativeKeyboard()
  reportListeners.add(onReport)
  paymentListeners.add(onPaymentChange)
  if (current.isOpen) onReport(current)
  return () => {
    reportListeners.delete(onReport)
    paymentListeners.delete(onPaymentChange)
  }
}
