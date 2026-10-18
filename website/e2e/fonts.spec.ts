import { expect, test } from "@playwright/test"

//The site serves Geist and Geist Mono itself (`src/assets/fonts/`): no page asks Google Fonts
//for a stylesheet or a font file, which the CSP (`font-src 'self'`) would refuse anyway, and
//both faces are in use once the fonts have settled.
const GOOGLE_FONTS = /^https?:\/\/fonts\.(googleapis|gstatic)\.com\//

for (const path of ["/", "/docs", "/docs/quick-start"]) {
  test(`${path} loads Geist and Geist Mono from the site, not from Google Fonts`, async ({
    page,
  }) => {
    const google: string[] = []
    page.on("request", (request) => {
      if (GOOGLE_FONTS.test(request.url())) google.push(request.url())
    })
    const response = await page.goto(path)
    expect(response?.status()).toBe(200)
    const faces = await page.evaluate(async () => {
      await document.fonts.ready
      //`check` is also true for a face that failed to load: the status says it arrived
      const loaded = (family: string) =>
        [...document.fonts].some(
          (f) => f.family.replace(/"/g, "") === family && f.status === "loaded",
        )
      return {
        sans: document.fonts.check("16px Geist") && loaded("Geist"),
        mono: document.fonts.check('16px "Geist Mono"') && loaded("Geist Mono"),
      }
    })
    expect(google).toEqual([])
    expect(faces).toEqual({ sans: true, mono: true })
  })
}
