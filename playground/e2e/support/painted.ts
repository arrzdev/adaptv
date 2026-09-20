import type { Locator } from "@playwright/test"
import { expect } from "@playwright/test"

/*
 * "The image is on screen", measured on the screen.
 *
 * `complete` and `naturalWidth` say the file arrived and decoded. Neither says it
 * was drawn: a zero-size box, `visibility: hidden`, an opaque sibling on top or an
 * SVG that decodes to nothing all pass them. So this takes the image's parent
 * box twice from the compositor — as it is, and with every `<img>` hidden — and
 * counts the pixels the image changed. Whatever else paints in that box (a
 * background, text behind the art) is in both shots and cancels out.
 *
 * Decoded in the page with a canvas, because the suite carries no PNG decoder,
 * and a data URL never touches the network, so it works on an offline tab too.
 */

/** Share (0–1) of the pixels in the image's parent box that change by more than 32 in any channel when `<img>`s are hidden. */
export async function paintedShare(image: Locator): Promise<number> {
  //the PARENT's box: a hidden <img> is not visible, and Playwright will not shoot it
  const box = image.locator("xpath=..")
  const shown = await box.screenshot()
  const hidden = await box.screenshot({
    style: "img { visibility: hidden !important; }",
  })
  return image.page().evaluate(
    async ([a, b]) => {
      const pixels = async (base64: string) => {
        const img = new Image()
        img.src = `data:image/png;base64,${base64}`
        await img.decode()
        const canvas = document.createElement("canvas")
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const context = canvas.getContext("2d")
        if (!context) throw new Error("no 2d context")
        context.drawImage(img, 0, 0)
        return context.getImageData(0, 0, canvas.width, canvas.height).data
      }
      const [on, off] = await Promise.all([pixels(a), pixels(b)])
      if (on.length !== off.length)
        throw new Error("the two shots differ in size")
      let changed = 0
      for (let i = 0; i < on.length; i += 4) {
        if (
          Math.abs(on[i] - off[i]) > 32 ||
          Math.abs(on[i + 1] - off[i + 1]) > 32 ||
          Math.abs(on[i + 2] - off[i + 2]) > 32
        )
          changed++
      }
      return changed / (on.length / 4)
    },
    [shown.toString("base64"), hidden.toString("base64")] as const,
  )
}

/** The `<img>` finished loading with real pixels, and they are on screen. */
export async function expectImagePainted(image: Locator, what: string) {
  await expect(image, `${what} is not visible`).toBeVisible()
  await expect
    .poll(
      () =>
        image.evaluate(
          (el) =>
            (el as HTMLImageElement).complete &&
            (el as HTMLImageElement).naturalWidth,
        ),
      { message: `${what} never finished loading`, timeout: 20_000 },
    )
    .toBeGreaterThan(0)
  //the stressed mascot changes 43-44% of its box (measured, chromium and webkit);
  //a tenth is far above anti-aliasing noise and far below the art
  expect(
    await paintedShare(image),
    `${what} loaded but did not paint`,
  ).toBeGreaterThan(0.1)
}
