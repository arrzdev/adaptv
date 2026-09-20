import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The two full-screen takeovers the shell mounts on a CONDITION rather than on a
 * route — `OrientationGuard` and `UpdateRequired` (`src/shell/shell-layout.tsx`).
 * Nothing in the app can open either from a button, so nothing ever rendered them
 * in a browser. Each is forced here through the path the shell itself reads:
 *
 * - the rotate guard through the media query it is built on,
 *   `(orientation: landscape) and (pointer: coarse)` — a touch context held
 *   sideways, rotated with `setViewportSize`;
 * - the update screen through the persisted record `useStoreRelease` reads at
 *   module load (`src/ota/store-release.ts`) and the `updateRequiredAfterDays`
 *   the playground's `adaptv.config.ts` declares. No lab fixture, no test prop:
 *   the record is seeded in `localStorage` and the document reloaded, which is
 *   exactly a native launch that finds itself stranded.
 *
 * The third screen nobody forces, the boot fallback, only exists in a BUILT
 * shell — `vite` dev serves Start's document, which carries no watchdog — so it
 * lives with the build-backed suite: `e2e-sw/boot-error.spec.ts`.
 *
 * ⚠︎ Every test states its viewport and touch capability. The chromium project is
 * a 1280x720 desktop, and `hasTouch` on it IS the rotate guard's condition; a
 * context that inherits the project's shape is testing whatever the project
 * happens to be.
 */

const DAY = 86_400_000
const STORE_RELEASE_KEY = "adaptv.ota.store-release"

const LANDSCAPE = { width: 844, height: 390 }
const PORTRAIT = { width: 390, height: 844 }

const GUARD_COPY = "Rotate your device to portrait to use ChopChop."
const UPDATE_COPY = "This version of the app is out of date."

const rotateGuard = (page: Page) =>
  page.getByRole("alert").filter({ hasText: GUARD_COPY })
const updateRequired = (page: Page) =>
  page.locator('[data-adaptv="update-required"]')

/**
 * Which full-screen alert is TOPMOST at the centre and four inset corners, as its
 * text — or `null` where a finger would land on the page itself.
 *
 * "Covers the page" is a hit-testing claim, not a visibility one: an overlay can
 * be visible and still let taps through (a `pointer-events-none`, a z-index under
 * the app), and a visible element over a transparent hole covers nothing. So this
 * asks the browser what a finger would land on.
 */
function topmostAlertText(page: Page) {
  return page.evaluate(() => {
    const w = window.innerWidth
    const h = window.innerHeight
    const points: Array<[number, number]> = [
      [w / 2, h / 2],
      [8, 8],
      [w - 8, 8],
      [8, h - 8],
      [w - 8, h - 8],
    ]
    return points.map(([x, y]) => {
      const alert = document
        .elementFromPoint(x, y)
        ?.closest("[role=alert]")
      return alert?.textContent?.trim() ?? null
    })
  })
}

/** Every sampled point landed on the alert whose text contains `marker`. */
async function expectCoveredBy(page: Page, marker: string | null) {
  const hits = await topmostAlertText(page)
  expect(
    hits.map((text) =>
      marker !== null && text?.includes(marker) ? marker : text,
    ),
    marker === null
      ? "nothing may be left over the page"
      : `every point a finger could land on must be "${marker}"`,
  ).toEqual(Array(5).fill(marker))
}

/**
 * Seed the stranded record and relaunch, the way a native launch finds it.
 *
 * The store reads `localStorage` once, at module load, so writing it into a live
 * document changes nothing until the next one — which is what makes the reload
 * the real trigger rather than a formality. `since` sits an hour inside the day
 * boundary so the age reads the same whole number however long the test takes.
 */
async function strandFor(page: Page, days: number) {
  await page.evaluate(
    ({ key, days, DAY }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          buildTag: "e2e0000000000000",
          since: Date.now() - days * DAY - 3_600_000,
        }),
      )
    },
    { key: STORE_RELEASE_KEY, days, DAY },
  )
  await page.reload()
  await awaitClientHandover(page)
}

test.describe("OrientationGuard — a touch phone held sideways", () => {
  test.use({ hasTouch: true, viewport: LANDSCAPE })

  test("covers the page in landscape, lifts in portrait, and comes back", async ({
    page,
  }) => {
    await page.goto("/lab/screens")
    await awaitClientHandover(page)

    //the premise, so a green run cannot mean "the emulation was not touch"
    expect(
      await page.evaluate(
        () =>
          matchMedia("(orientation: landscape) and (pointer: coarse)")
            .matches,
      ),
    ).toBe(true)

    await expect(rotateGuard(page)).toBeVisible()
    await expectCoveredBy(page, GUARD_COPY)

    await page.setViewportSize(PORTRAIT)
    await expect(rotateGuard(page)).toHaveCount(0)
    //and the page underneath is reachable again — the guard is gone, not hidden
    //behind a transparent layer still eating taps
    await expectCoveredBy(page, null)
    await expect(
      page.getByRole("heading", { name: "Full-screen chrome" }),
    ).toBeVisible()

    //live, not a one-shot decision at mount
    await page.setViewportSize(LANDSCAPE)
    await expect(rotateGuard(page)).toBeVisible()
  })
})

test.describe("OrientationGuard — a desktop window", () => {
  //the same landscape shape as above, with the one difference the guard keys on
  test.use({
    hasTouch: false,
    isMobile: false,
    viewport: { width: 1280, height: 720 },
  })

  test("never guards a fine pointer, however landscape the window", async ({
    page,
  }) => {
    //The guard decides only once the manifest's `orientation` has arrived — before
    //that it reads `any` and renders nothing on EVERY device. So absence proves
    //nothing until the manifest has been fetched and read, which is waited on here.
    const manifest = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/manifest.json",
    )
    await page.goto("/lab/screens")
    await awaitClientHandover(page)
    expect((await (await manifest).json()).orientation).toBe("portrait")

    expect(
      await page.evaluate(
        () => matchMedia("(orientation: landscape)").matches,
      ),
      "the window must BE landscape, or this is the portrait test again",
    ).toBe(true)

    //two frames after the manifest was read: the state update has committed
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve()),
          ),
        ),
    )
    await expect(rotateGuard(page)).toHaveCount(0)
    await expectCoveredBy(page, null)
  })
})

test.describe("UpdateRequired — an install the channel has moved past", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: PORTRAIT })

  test("takes the screen past the threshold, states the age, and offers no way round it", async ({
    page,
  }) => {
    await page.goto("/lab/ota")
    await awaitClientHandover(page)
    //the control: an install that never fell behind gets nothing
    await expect(
      page.getByText("up to date", { exact: true }),
    ).toBeVisible()
    await expect(updateRequired(page)).toHaveCount(0)

    await strandFor(page, 20)

    const screen = updateRequired(page)
    await expect(screen).toBeVisible()
    await expect(screen).toHaveAttribute("role", "alert")
    await expect(screen.getByText(UPDATE_COPY)).toBeVisible()
    //the age, never a promise that the new version is downloadable yet
    await expect(
      screen.getByText(
        "It has not been able to update for 20 days. Update from the App Store or Google Play to continue.",
      ),
    ).toBeVisible()

    //Documented to carry NO action: adaptv knows the channel moved, not that the
    //release cleared review, so a "get it now" control could send someone to a
    //store page with nothing newer on it. An app that knows supplies its own
    //`updateRequiredScreen`.
    await expect(screen.getByRole("button")).toHaveCount(0)
    await expect(screen.getByRole("link")).toHaveCount(0)

    //and a hard stop: nothing underneath is reachable
    await expectCoveredBy(page, UPDATE_COPY)

    //persisted, so it is still there on the next launch
    await page.reload()
    await awaitClientHandover(page)
    await expect(updateRequired(page)).toBeVisible()
  })

  for (const [days, blocked] of [
    [13, false],
    [14, true],
  ] as const) {
    test(`at ${days} days behind a 14-day policy the screen is ${blocked ? "up" : "not up"}`, async ({
      page,
    }) => {
      await page.goto("/lab/ota")
      await awaitClientHandover(page)
      await strandFor(page, days)

      //the lab's own readout of the same hook proves the record WAS read — without
      //it, an absent screen at 13 days is equally consistent with a seed that
      //never landed. Scoped out of the way of the screen, which covers it at 14.
      await expect(
        page.getByText("behind", { exact: true }),
      ).toBeAttached()
      await expect(page.getByText(`${days}d — `)).toBeAttached()

      if (blocked) await expect(updateRequired(page)).toBeVisible()
      else await expect(updateRequired(page)).toHaveCount(0)
    })
  }
})

test.describe("both at once", () => {
  test.use({ hasTouch: true, viewport: LANDSCAPE })

  test("an install that cannot update sits above one held the wrong way round", async ({
    page,
  }) => {
    await page.goto("/lab/ota")
    await awaitClientHandover(page)
    await strandFor(page, 20)

    //both mounted, so the order between them is a real question
    await expect(rotateGuard(page)).toBeVisible()
    await expect(updateRequired(page)).toBeVisible()

    //shell-layout mounts UpdateRequired last for this: rotating the phone cannot
    //fix a stranded install, so the screen that says so must be the one on top
    await expectCoveredBy(page, UPDATE_COPY)
  })
})
