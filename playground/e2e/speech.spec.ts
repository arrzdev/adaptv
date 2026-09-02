import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Speech — text to speech over speechSynthesis, driven headless on BOTH engines.
 * Nothing here listens to audio: the assertions are on the engine's own events,
 * surfaced by the page as words. Measured 2026-09-02 on this Mac (Playwright's
 * bundled chromium and webkit): both have speechSynthesis on localhost; chromium
 * reports an empty voice list synchronously and 191 voices after voiceschanged
 * (default "Samantha"); webkit has 223 synchronously (default "Majed"); on both,
 * an utterance fires start and then end within a few seconds even headless. So
 * both engines are expected to reach `ready`, a voice count above zero, and
 * `spoke` — a skip here would be hiding a real answer.
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

  test("the engine reports ready with a voice list and a default", async ({
    page,
  }) => {
    //chromium passes through `loading` until voiceschanged; webkit is ready at once
    await expect(page.getByTestId("speech-status")).toHaveText("ready", {
      timeout: 5_000,
    })
    const voices = Number(
      await page.getByTestId("speech-voices").innerText(),
    )
    expect(voices).toBeGreaterThan(0)
    await expect(page.getByTestId("speech-default")).not.toHaveText("—")
    await expect(page.getByTestId("speech-last")).toHaveText("—")
    await expect(page.getByTestId("speech-reason")).toHaveText("—")
  })

  test("Speak runs the utterance to its end and resolves spoke", async ({
    page,
  }) => {
    await expect(page.getByTestId("speech-status")).toHaveText("ready", {
      timeout: 5_000,
    })
    await page.getByTestId("speech-speak").click()

    await expect(page.getByTestId("speech-speaking")).toHaveText("true", {
      timeout: 5_000,
    })
    await expect(page.getByTestId("speech-last")).toHaveText("spoke", {
      timeout: 15_000,
    })
    await expect(page.getByTestId("speech-speaking")).toHaveText("false")
    await expect(page.getByTestId("speech-reason")).toHaveText("—")
    await expect(page.locator("[data-lab-log] li")).toHaveCount(2)
  })

  test("Stop mid-utterance resolves cancelled, not spoke", async ({
    page,
  }) => {
    await expect(page.getByTestId("speech-status")).toHaveText("ready", {
      timeout: 5_000,
    })
    await page.getByTestId("speech-text").fill(LONG_SENTENCE)
    await page.getByTestId("speech-speak").click()
    await expect(page.getByTestId("speech-speaking")).toHaveText("true", {
      timeout: 5_000,
    })

    await page.getByTestId("speech-stop").click()

    await expect(page.getByTestId("speech-last")).toHaveText("cancelled", {
      timeout: 5_000,
    })
    await expect(page.getByTestId("speech-speaking")).toHaveText("false")
    await expect(page.getByTestId("speech-reason")).toHaveText("—")
  })
})
