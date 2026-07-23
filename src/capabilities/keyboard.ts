//Native keyboard accessor. On a Capacitor build the OS reports the keyboard with
//EXACT height + will-show/will-hide events — none of the web visualViewport
//heuristics (dismiss/height confirms, field-switch transient filtering) are needed.
//Resize mode is set to `None` so the OS doesn't push the webview; adaptv lifts
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
import { isNativePlatform } from "#adaptv/utils/platform"

export type KeyboardInfo = {
  isOpen: boolean
  height: number
}

type Listener = (info: KeyboardInfo) => void

let current: KeyboardInfo = { isOpen: false, height: 0 }
const listeners = new Set<Listener>()
let attached = false

function emit(next: KeyboardInfo): void {
  current = next
  for (const listener of listeners) listener(next)
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
  try {
    //don't let the OS resize/push the webview — we lift content ourselves
    void Keyboard.setResizeMode({ mode: KeyboardResize.None })
  } catch {
    //older plugin / unsupported — height reporting below still works
  }
  //never removed — keyboard visibility is an app-global concern
  void Keyboard.addListener("keyboardWillShow", (info) =>
    emit({ isOpen: true, height: info.keyboardHeight }),
  )
  void Keyboard.addListener("keyboardWillHide", () =>
    emit({ isOpen: false, height: 0 }),
  )
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
 */
export function subscribeNativeKeyboard(cb: Listener): () => void {
  if (!isNativePlatform()) return () => {}
  //defensive: normally the shell has already initialised at startup
  initNativeKeyboard()
  listeners.add(cb)
  if (current.isOpen) cb(current)
  return () => {
    listeners.delete(cb)
  }
}
