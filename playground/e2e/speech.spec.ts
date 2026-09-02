import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Speech — text to speech over speechSynthesis, driven headless on BOTH engines.
 * Nothing here listens to audio: the assertions are on the engine's own events,
 * surfaced by the page as words. Measured 2026-09-02 on this Mac (Playwright's
 * bundled chromium and webkit): both have speechSynthesis on localhost; chromium
 * reports an empty voice list synchronously and 191 voices after voiceschanged
 * (default "Samantha"); webkit has 223 synchronously (default "Majed"); on both,
 * an utterance fires start and then end within a few seconds even headless.
 *
 * CI measures something else. On ubuntu-latest the headless chromium has the
 * API but no speech-dispatcher behind it, so getVoices() stays empty for good
 * and the status settles on `no-voices` after the module's bounded wait. That
 * is a real, different answer, not a broken run, so the spec branches on the
 * settled status rather than pinning `ready`: with voices, the engine must list
 * them and reach `spoke`; without, it must never claim to have spoken. What it
 * never accepts is `unsupported` (the API is in every browser we run), a
 * status that fails to settle, or a voiceless engine resolving `spoke`.
 */

/**
 * Wait for the client to take over before pressing anything.
 *
 * The buttons are server-rendered, so a click that lands before hydration hits
 * a button with no handler and the outcome row never moves. The splash
 * self-unmounts only once the client has hydrated, so its disappearance is the
 * one honest "React is driving now" signal — see clipboard.spec.ts for the full
 * account of why this is not load flake.
 */
async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

/** What the page renders for "nothing to report" — the one glyph it uses. */
const NONE = "—"

/**
 * The status once the module has stopped moving: `loading` is chromium's beat
 * before voiceschanged (or before the wait gives up), so it is waited through;
 * `unsupported` fails here on purpose, since every engine in the matrix has
 * the API.
 */
async function settledStatus(page: Page): Promise<"ready" | "no-voices"> {
  const status = page.getByTestId("speech-status")
  await expect(status).toHaveText(/^(ready|no-voices)$/, {
    timeout: 5_000,
  })
  return (await status.innerText()).trim() as "ready" | "no-voices"
}

/**
 * Every outcome a voiceless engine is allowed to settle on. The module
 * resolves `silent` when no start event arrives, `cancelled` when Stop lands
 * first, and `failed` when the engine says so itself; `spoke` is never one of
 * them, and neither is the outcome row staying empty.
 */
const NOT_SPOKEN = /^(cancelled|silent|failed)$/

/** About forty words — long enough that Stop lands while the engine is still talking. */
const LONG_SENTENCE =
  "The quick brown fox jumps over the lazy dog while the patient grey heron " +
  "stands perfectly still at the edge of the quiet pond, waiting for the small " +
  "silver fish to drift a little closer to the surface before it strikes."

test.describe("Speech", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/speech")
    await awaitClientHandover(page)
  })

  test("the engine settles on ready with voices, or on no-voices with none", async ({
    page,
  }) => {
    const status = await settledStatus(page)
    const voices = Number(
      await page.getByTestId("speech-voices").innerText(),
    )
    if (status === "ready") {
      expect(voices).toBeGreaterThan(0)
      await expect(page.getByTestId("speech-default")).not.toHaveText(NONE)
    } else {
      expect(voices).toBe(0)
      await expect(page.getByTestId("speech-default")).toHaveText(NONE)
    }
    await expect(page.getByTestId("speech-last")).toHaveText(NONE)
    await expect(page.getByTestId("speech-reason")).toHaveText(NONE)
  })

  test("Speak resolves spoke with voices, and never spoke without them", async ({
    page,
  }) => {
    const status = await settledStatus(page)
    await page.getByTestId("speech-speak").click()

    if (status === "ready") {
      await expect(page.getByTestId("speech-speaking")).toHaveText(
        "true",
        {
          timeout: 5_000,
        },
      )
      await expect(page.getByTestId("speech-last")).toHaveText("spoke", {
        timeout: 15_000,
      })
      await expect(page.getByTestId("speech-reason")).toHaveText(NONE)
    } else {
      //no start event ever comes, so the module's silent wait (2 s) is the
      //slowest honest answer; 4 s leaves it room without waiting on a clock
      await expect(page.getByTestId("speech-last")).toHaveText(
        NOT_SPOKEN,
        {
          timeout: 4_000,
        },
      )
      const last = (
        await page.getByTestId("speech-last").innerText()
      ).trim()
      if (last === "failed") {
        await expect(page.getByTestId("speech-reason")).not.toHaveText(
          NONE,
        )
      } else {
        await expect(page.getByTestId("speech-reason")).toHaveText(NONE)
      }
    }
    await expect(page.getByTestId("speech-speaking")).toHaveText("false")
    await expect(page.locator("[data-lab-log] li")).toHaveCount(2)
  })

  test("Stop after Speak resolves cancelled with voices, and never spoke without them", async ({
    page,
  }) => {
    const status = await settledStatus(page)
    await page.getByTestId("speech-text").fill(LONG_SENTENCE)
    await page.getByTestId("speech-speak").click()
    if (status === "ready") {
      await expect(page.getByTestId("speech-speaking")).toHaveText(
        "true",
        {
          timeout: 5_000,
        },
      )
    }

    await page.getByTestId("speech-stop").click()

    if (status === "ready") {
      await expect(page.getByTestId("speech-last")).toHaveText(
        "cancelled",
        {
          timeout: 5_000,
        },
      )
      await expect(page.getByTestId("speech-reason")).toHaveText(NONE)
    } else {
      await expect(page.getByTestId("speech-last")).toHaveText(
        NOT_SPOKEN,
        {
          timeout: 4_000,
        },
      )
    }
    await expect(page.getByTestId("speech-speaking")).toHaveText("false")
  })
})
