import { useSyncExternalStore } from "react"
import type {
  AnnounceOptions,
  AnnounceOutcome,
  ScreenReaderState,
  ScreenReaderStatus,
} from "#adaptv/capabilities/screen-reader"
import {
  announce,
  getScreenReaderState,
  subscribeScreenReader,
} from "#adaptv/capabilities/screen-reader"

const SERVER: ScreenReaderState = { status: "unknown" }

export type UseScreenReaderResult = {
  /** `on` or `off` as the OS last said; `unknown` on the web, the server, and a binary without the plugin. */
  status: ScreenReaderStatus
  /** Say something to the reader. Resolves the outcome; never rejects. */
  announce: (
    text: string,
    options?: AnnounceOptions,
  ) => Promise<AnnounceOutcome>
}

/**
 * The screen reader, as a hook. The status is the module's snapshot through
 * `useSyncExternalStore`, so every consumer sees one value and the plugin is
 * bound once; the server and the first client render both read `unknown`,
 * which is why the row cannot mismatch on hydration.
 */
export function useScreenReader(): UseScreenReaderResult {
  const state = useSyncExternalStore(
    subscribeScreenReader,
    getScreenReaderState,
    () => SERVER,
  )
  return { status: state.status, announce }
}
