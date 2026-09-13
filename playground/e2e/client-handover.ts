import type { Page } from "@playwright/test"
import { test as base, expect } from "@playwright/test"

/*
 * The client-handover gate, and the guard for the one thing it cannot see.
 *
 * Shared by the specs that press server-rendered controls and read a readout
 * back. Import `test` and `expect` from here rather than from Playwright, so the
 * guard below is armed for every test in the file.
 */

/**
 * Wait for the client to take over before pressing anything.
 *
 * Every control these specs press is server-rendered, so a `waitFor()` on it is
 * satisfied by inert HTML. The splash is server-rendered too, and it unmounts
 * itself only after the client has hydrated, the local store has seeded and the
 * handoff has painted, so its absence means React owns the page. That was
 * measured on both engines, cold and under load: every sample taken the moment
 * this resolved had the lab's roots hydrated. The timeout is a ceiling for a
 * cold server, whose first transform of the route can outrun the 5s default.
 */
export async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

/**
 * Fails a test whose page the dev server told to reload.
 *
 * The usual cause is a SECOND dev server booting in the same checkout: every
 * boot rewrites `.adaptv/routeTree.gen.ts`, and the server this suite runs on
 * answers that write with a full reload of every page it serves. Two `test:e2e`
 * runs at once in one worktree, or a dev server started beside the suite, is
 * enough. The reload resets every readout, and it can land just after the gate
 * above has passed, because the client waits a beat before reloading and the
 * old document is still on screen with its splash gone. The test then presses
 * the new document's inert server HTML, and the report reads as a component
 * that ignored the press (Expected "0", Received "25"). Vite announces the
 * reload on its HMR socket, so this reads it there and names the cause instead.
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
