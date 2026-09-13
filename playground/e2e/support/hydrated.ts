import type { Page } from "@playwright/test"
import { expect } from "@playwright/test"

/*
 * The hydration gate — the one definition every spec in `e2e/` waits on.
 *
 * Every lab route is server-rendered, so after `page.goto()` the controls, the
 * headings and the readouts are already in the DOM as inert HTML. `waitFor()` and
 * `toBeVisible()` are satisfied by that HTML, and whatever the test does next lands
 * before React is listening: a click is a no-op, a Space press toggles the native
 * input without firing `onCheckedChange`, a CDP gesture is handled by nobody, an
 * attribute stamped by hand is overwritten (or reported as a hydration mismatch)
 * when the client catches up, and a self-grading readout sits on its SSR
 * placeholder ("measuring…") until the test times out.
 *
 * It is not load flake, and retries or warm-ups are not the fix. Playwright boots
 * its own dev server per run, so whichever test reaches a route first pays the cold
 * transform cost and loses the race, while every test after it wins — which reads
 * exactly like flake. A dev session left running hides it, because
 * `reuseExistingServer` hands the suite a warm server; CI is always cold.
 *
 * The splash is server-rendered too, and it self-unmounts only once the client has
 * hydrated and the local store has seeded — so its disappearance is the one honest
 * "React is driving now" signal. Measured on both engines: at `goto` the splash is
 * mounted and no element carries React's props yet; React attaches ~1s later and the
 * splash leaves ~1s after that (the app holds it for a minimum on screen). It is in
 * the SSR HTML of `/` and of every lab route the suite visits (checked one by one),
 * so the wait is not vacuous there, and `screens.spec.ts` pins the attribute name
 * against the critical CSS so a rename cannot make it so.
 *
 * ⚠︎ The one route where it IS vacuous is the app's own 404. The not-found boundary
 * is the root route, no layout route mounts under it, and no splash is rendered at
 * all — so this resolves on the server's HTML there. Do not gate a not-found page
 * with it and believe React is listening.
 *
 * Why 20 seconds. The 5s `expect` default is shorter than a cold route's first
 * transform on a loaded machine: the route's split component chunk and the
 * providers layout are requested only after the entry runs, and under load the dev
 * server has been seen to take longer than 5s to answer them — the page then sits
 * on its SSR markup and the test fails on whatever it asserted next, far from the
 * cause. 20s is generous on purpose, because a tight bound here re-creates the
 * failure it removes. It stays under Playwright's 30s test timeout so that a page
 * that never hydrates fails HERE, with the message below, instead of as a bare
 * test timeout on a later line.
 *
 * A zero count is also what a document that is NOT the app reads — a dev server
 * answering the navigation with its own error page has no splash to wait for, so
 * the gate would pass on it at once and the test would fail five seconds later on
 * an element that "is not found". So the premise is asserted first: the app's
 * screen frame, which the shell server-renders on every route (the 404 included),
 * must be in the document. Both waits share the one budget.
 */
const CLIENT_HANDOVER_TIMEOUT_MS = 20_000

/** Resolve once React has taken over the page; fail with a message naming why if it never does. */
export async function awaitClientHandover(page: Page) {
  const deadline = Date.now() + CLIENT_HANDOVER_TIMEOUT_MS
  await expect(
    page.locator("[data-adaptv-screen]").first(),
    "this document is not the app (no [data-adaptv-screen]) — check what the dev " +
      "server answered the navigation with",
  ).toBeAttached({ timeout: CLIENT_HANDOVER_TIMEOUT_MS })
  await expect(
    page.locator("[data-adaptv-splash]"),
    "the launch splash is still mounted, so the client never took over this page — " +
      "check the console for an error at boot, then the dev server for a module it never served",
  ).toHaveCount(0, { timeout: Math.max(deadline - Date.now(), 1) })
}
