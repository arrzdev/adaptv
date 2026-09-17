import { test as base, expect } from "@playwright/test"

/*
 * The reload guard — a `test` that fails when the dev server told its page to
 * reload.
 *
 * Import `test` and `expect` from here instead of from Playwright, and the guard
 * is armed for every test in the file. It is the partner of the hydration gate
 * (`awaitClientHandover`, e2e/support/hydrated.ts), and it covers the one thing
 * that gate cannot see.
 *
 * A full reload resets every readout on a lab page, and it can land just AFTER
 * the gate has passed: the client waits a beat before reloading, so the old
 * document is still on screen with its splash gone. The test then presses the new
 * document's inert server HTML, and the report reads as a component that ignored
 * the press (Expected "0", Received "25"). Vite announces the reload on its HMR
 * socket first, so the guard reads it there and fails the test naming the cause.
 *
 * What still sends one. The usual cause used to be a second dev server booting
 * in the same checkout: every boot rewrote `.adaptv/routeTree.gen.ts`, and the
 * server under test reloaded every page it served. Since #137 a rewrite that
 * changes nothing is not a change, but a tree that really differs still reloads
 * the page (a second server booted after a route was added, a branch switched
 * under a running suite), and so does an edit no hot boundary accepts. Vite's
 * dependency optimizer reloads too when it discovers a dependency mid-run; that
 * message names no file, which is what "an unnamed change" below means.
 */
export const test = base.extend<{ devServerReloadGuard: undefined }>({
  devServerReloadGuard: [
    async ({ page }, use) => {
      const reloads = new Set<string>()
      page.on("websocket", (socket) => {
        socket.on("framereceived", ({ payload }) => {
          if (typeof payload !== "string") return
          let message: { type?: string; triggeredBy?: string }
          try {
            message = JSON.parse(payload)
          } catch {
            return
          }
          if (message.type === "full-reload") {
            reloads.add(message.triggeredBy ?? "an unnamed change")
          }
        })
      })
      await use(undefined)
      if (reloads.size > 0) {
        throw new Error(
          `the dev server reloaded this page during the test (triggered by ${[...reloads].join(", ")}), so its readouts restarted from their initial values. Is another dev server or e2e run using this checkout?`,
        )
      }
    },
    { auto: true },
  ],
})

export { expect }
