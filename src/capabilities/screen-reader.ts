//Screen reader — whether one is driving the app, and a way to announce to it.
//ONE honest shape over three very different targets:
//  • iOS     → VoiceOver, read as `UIAccessibility.isVoiceOverRunning` and its
//              status-change notification through @capacitor/screen-reader; an
//              announcement is `UIAccessibility.post(.announcement)`, which VoiceOver
//              speaks and nothing else does.
//  • Android → TalkBack, read as touch exploration through the same plugin (Switch
//              Access and Voice Access do not turn it on and are not readers); an
//              announcement is spoken through TextToSpeech only while a reader is on.
//  • web     → no browser can tell whether a reader is running, so the status is
//              `unknown` rather than a guess. An announcement is a polite ARIA live
//              region: a reader that IS running speaks it, and one that is not costs
//              nothing. The plugin's own web `speak` uses speechSynthesis, which talks
//              at every user whether or not they use a reader; that is the speech
//              capability's job, not this one's.
//
//The status is a subscribe/get pair on the network capability's pattern, so a
//data layer can read it without React; the plugin's `stateChange` keeps it live on
//native and it is re-read on resume, because a reader turned on in Settings while
//the app was in the background fires no event the app was awake for.
import type { PluginListenerHandle } from "@capacitor/core"
import { ScreenReader } from "@capacitor/screen-reader"
import { onResume } from "#adaptv/capabilities/app-state"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isNativePlatform } from "#adaptv/utils/platform"

/**
 * `"on"` and `"off"` are the OS's answer; `"unknown"` is the web and the server,
 * where nothing can be asked, and a native binary built before the plugin.
 */
export type ScreenReaderStatus = "on" | "off" | "unknown"

export type ScreenReaderState = { status: ScreenReaderStatus }

/**
 * `"announced"` — handed to a reader (native) or written to the live region (web).
 * `"silent"` — native with no reader running, or a plugin call that failed.
 * `"unsupported"` — nothing here can carry it: the server, or a binary without the plugin.
 */
export type AnnounceOutcome = "announced" | "silent" | "unsupported"

export interface AnnounceOptions {
  /** ISO 639-1 language of the text; honoured by Android's speech and by the web region's `lang`. */
  language?: string
}

const UNKNOWN: ScreenReaderState = { status: "unknown" }
const ON: ScreenReaderState = { status: "on" }
const OFF: ScreenReaderState = { status: "off" }

const listeners = new Set<() => void>()
let snapshot: ScreenReaderState = UNKNOWN
let bound = false

/**
 * The live native binding, or `null` when none is held. `disposed` is per binding
 * because the bridge answers asynchronously: the last subscriber can leave before
 * `addListener` resolves (useSyncExternalStore under StrictMode always does in
 * dev), and the handle that arrives afterwards must remove itself rather than
 * keep a listener nobody will ever release — or, once a new subscriber has bound
 * again, stand in for that binding's own handle.
 */
type NativeBinding = {
  disposed: boolean
  handle: PluginListenerHandle | null
  unResume: () => void
}
let nativeBinding: NativeBinding | null = null

//A bridge call that rejects (plugin missing from this binary, an OS error) is
//fire-and-forget in the subscription, so nothing would handle it: it would reach
//the window's `unhandledrejection` event, and with it the console and any error
//reporter the app installed. The last known status is the degraded answer.
//Passed as `.then`'s second argument, not `.catch`, so an exception thrown in the
//fulfilment callback still surfaces.
const ignoreBridgeRejection = () => {}

function nativePlugin(): boolean {
  return isNativePlatform() && hasNativePlugin("ScreenReader")
}

/** Replace the snapshot only when the status moved, so a store sees one object per change. */
function commit(next: ScreenReaderState): ScreenReaderState {
  if (next.status === snapshot.status) return snapshot
  snapshot = next
  for (const cb of listeners) cb()
  return snapshot
}

/** The last known state, synchronously. `unknown` until something has read it. */
export function getScreenReaderState(): ScreenReaderState {
  return snapshot
}

/**
 * Ask the OS once. Resolves the new state; a bridge failure reads `unknown` and
 * never rejects. Only the bridge call is guarded: a subscriber that throws while
 * the answer is committed rejects with its own error, rather than being caught
 * here and turning the OS's answer into `unknown`.
 */
export async function readScreenReader(): Promise<ScreenReaderState> {
  if (!nativePlugin()) return commit(UNKNOWN)
  let enabled: boolean
  try {
    enabled = (await ScreenReader.isEnabled()).value
  } catch {
    return commit(UNKNOWN)
  }
  return commit(enabled ? ON : OFF)
}

/**
 * Follow the status. Binds the plugin's `stateChange` and a resume re-read on
 * the first subscriber and releases both after the last; returns the
 * unsubscribe. On the web there is nothing to follow and the callback never fires.
 */
export function subscribeScreenReader(cb: () => void): () => void {
  listeners.add(cb)
  if (!bound) {
    bound = true
    if (nativePlugin()) bindNative()
  }
  return () => {
    listeners.delete(cb)
    if (listeners.size === 0 && bound) {
      bound = false
      unbindNative()
    }
  }
}

function bindNative(): void {
  const binding: NativeBinding = {
    disposed: false,
    handle: null,
    unResume: onResume(() => {
      void readScreenReader()
    }),
  }
  nativeBinding = binding
  void readScreenReader()
  void ScreenReader.addListener("stateChange", (state) => {
    commit(state.value ? ON : OFF)
  }).then((handle) => {
    if (binding.disposed) void handle.remove().catch(ignoreBridgeRejection)
    else binding.handle = handle
  }, ignoreBridgeRejection)
}

function unbindNative(): void {
  if (!nativeBinding) return
  nativeBinding.disposed = true
  void nativeBinding.handle?.remove().catch(ignoreBridgeRejection)
  nativeBinding.unResume()
  nativeBinding = null
}

let region: HTMLElement | null = null

/** The one polite live region, created on first use and kept off-screen but in the tree. */
function liveRegion(): HTMLElement | null {
  if (typeof document === "undefined") return null
  if (region?.isConnected) return region
  const el = document.createElement("div")
  el.setAttribute("role", "status")
  el.setAttribute("aria-live", "polite")
  el.setAttribute("aria-atomic", "true")
  el.setAttribute("data-adaptv-announcer", "")
  el.style.cssText =
    "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0"
  document.body.appendChild(el)
  region = el
  return el
}

/**
 * Say something to the reader. Resolves the outcome; never rejects. On the
 * web the region is cleared first and filled on the next task, because a live
 * region announces mutations and the same text set twice is not one.
 */
export async function announce(
  text: string,
  { language }: AnnounceOptions = {},
): Promise<AnnounceOutcome> {
  if (nativePlugin()) {
    //The snapshot is only live while something subscribes; without a
    //subscriber it is whatever the last read said, and a reader switched on
    //since then would be skipped as `silent`. So ask the OS unless it is live.
    const state =
      bound && snapshot.status !== "unknown"
        ? snapshot
        : await readScreenReader()
    if (state.status !== "on") return "silent"
    try {
      await ScreenReader.speak({ value: text, language })
      return "announced"
    } catch {
      return "silent"
    }
  }
  if (isNativePlatform()) return "unsupported"
  const el = liveRegion()
  if (!el) return "unsupported"
  el.textContent = ""
  if (language) el.lang = language
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  el.textContent = text
  return "announced"
}
