import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The app boots from its own origin and nothing else.
 *
 * The stylesheet used to open with a Google Fonts `@import url(...)`. A CSS import
 * blocks the stylesheet that holds it, and that stylesheet blocks first paint, so
 * every cold launch waited on a DNS lookup, a TLS handshake and a CSS response from
 * fonts.googleapis.com before drawing a pixel. Offline the request failed and the
 * text fell back to the system font, which is not the app the precache promised. The
 * font now ships from the app's own bundle (`@fontsource-variable/inter`).
 *
 * Asserted as "every request is same-origin" rather than "no request to Google", so
 * the next third-party font, script or image in the boot path fails here too.
 */
test("the boot requests nothing from another origin", async ({
  page,
  baseURL,
}) => {
  const origin = new URL(baseURL as string).origin
  const foreign: string[] = []
  page.on("request", (request) => {
    const url = request.url()
    //inline payloads are not network requests
    if (url.startsWith("data:") || url.startsWith("blob:")) return
    if (new URL(url).origin !== origin) foreign.push(url)
  })

  const response = await page.goto("/")
  expect(response?.ok(), `navigation status: ${response?.status()}`).toBe(
    true,
  )
  await awaitClientHandover(page)
  //the font faces are requested only once text using them is laid out
  await page.evaluate(() => document.fonts.ready)

  expect(foreign, `cross-origin requests:\n${foreign.join("\n")}`).toEqual(
    [],
  )
})

test("the app's text is set in the bundled Inter", async ({ page }) => {
  await page.goto("/")
  await awaitClientHandover(page)
  await page.evaluate(() => document.fonts.ready)

  //not `document.fonts.check()`: it answers true for a family no face declares, so
  //it would pass with no font at all. Count faces of the family that really loaded.
  const loaded = await page.evaluate(
    () =>
      [...document.fonts].filter(
        (face) =>
          face.family.replace(/"/g, "") === "Inter Variable" &&
          face.status === "loaded",
      ).length,
  )
  expect(loaded).toBeGreaterThan(0)
})
