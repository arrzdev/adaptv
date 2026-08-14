import { expect, test } from "@playwright/test"
import { bootControlled, workerState } from "./sw"

/*
 * The worker exists, installs, and precached the app.
 *
 * This is the floor. Everything else in this suite assumes it, and until now
 * nothing in CI asserted it at all — the SW only exists in a BUILD, and the main
 * e2e harness drives dev, where adaptv destroys it on purpose.
 */

test.describe("registration", () => {
  test("registers, activates and controls the page", async ({ page }) => {
    await bootControlled(page)
    const state = await workerState(page)
    expect(state.controlled).toBe(true)
    expect(state.active).toBe("activated")
  })

  test("precaches the whole app, including the shell", async ({
    page,
  }) => {
    await bootControlled(page)
    const state = await workerState(page)

    //"Install downloads the whole app" is the design (§3.2) — it is what makes an
    //installed PWA navigate like the native build. A precache that quietly shrank
    //to a handful of entries is an app that is fast only sometimes, and nothing
    //else here would notice.
    expect(state.precachedCount).toBeGreaterThan(50)

    //The navigation route BINDS to the shell. A build where it is missing from
    //the manifest produces a worker that either falls through to the browser's
    //error page (ssr) or throws `non-precached-url` and never installs (spa).
    const shell = state.precached.filter((url) =>
      /adaptv-shell\.html|\/index\.html/.test(url),
    )
    expect(
      shell,
      `no app shell among ${state.precachedCount} entries`,
    ).not.toHaveLength(0)
  })

  test("precaches no route DOCUMENT — that would be a cross-user leak", async ({
    page,
  }) => {
    await bootControlled(page)
    const state = await workerState(page)

    //Cache Storage is keyed by URL and scoped per-ORIGIN, not per-user, so an SSR
    //document in there is served to whoever asks next. The glob deliberately has
    //no `html` in it and the shell is added BY NAME; this asserts that property
    //of the shipped manifest rather than trusting the glob to stay that way.
    //→ DECISIONS.md B5/B25, RENDERING.md §3.2
    const documents = state.precached
      .map((url) => new URL(url).pathname)
      .filter((pathname) => pathname.endsWith(".html"))
      .filter(
        (pathname) => !/adaptv-shell\.html|\/index\.html/.test(pathname),
      )
    expect(documents, "a route document reached the precache").toEqual([])
  })
})
