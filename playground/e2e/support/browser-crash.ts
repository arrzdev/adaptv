import type { Page } from "@playwright/test"

/*
 * A crash of WebKit's network process, told apart from the app losing data.
 *
 * Playwright's WebKit contexts are ephemeral: IndexedDB, localStorage and the
 * cookie jar live in the memory of the network process, not on disk. When that
 * process dies the browser starts a new one with empty storage, so the next
 * document reads an empty store and the tasks app shows "0 pending" — the
 * symptom of lost writes, though every write had committed.
 *
 * The Linux WebKit build does crash that way under a reload storm on a loaded
 * machine: each reload cancels a hundred dev-server module requests, a child
 * process logs a GLib refcount assertion and then glibc's "corrupted
 * double-linked list", and the browser's stderr says "WebKit encountered an
 * internal error. This is a WebKit bug." Safari's network stack is not GLib,
 * and Safari keeps IndexedDB on disk; this is the test browser, not something
 * the app can guard against.
 *
 * The page sees the crash in two ways: each load in flight fails with "WebKit
 * encountered an internal error", and an open WebSocket (the dev server's HMR
 * socket) reports "Network process crashed". Either one is enough.
 */

const CRASH_SIGNS = [
  /WebKit encountered an internal error/,
  /Network process crashed/,
]

export type NetworkProcessWatch = {
  /** The first sign of a crash seen so far, or null. */
  crash: () => string | null
  /** An assertion message: `what`, plus the crash when there was one. */
  explain: (what: string) => string
}

/** Watch `page` for the signs that WebKit's network process crashed. */
export function watchNetworkProcess(page: Page): NetworkProcessWatch {
  let first: string | null = null
  const note = (text: string) => {
    if (first === null && CRASH_SIGNS.some((sign) => sign.test(text))) {
      first = text
    }
  }
  page.on("requestfailed", (request) =>
    note(`${request.failure()?.errorText ?? ""} (${request.url()})`),
  )
  page.on("console", (message) => {
    if (message.type() === "error") note(message.text())
  })
  return {
    crash: () => first,
    explain: (what) =>
      first === null
        ? what
        : `${what} — but WebKit's network process crashed during the test ` +
          `(${first}), which empties an ephemeral context's storage: read this ` +
          "as a browser crash, not as the app losing writes",
  }
}
