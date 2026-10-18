import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * A swipeable row in a rounded card and in an inset list: the actions take the
 * corners of the surface they sit in, at rest, mid-swipe and open.
 *
 * The root is the one clipping surface (overflow + a clip-path mirrored from its
 * radius, swipeable.tsx `syncRootClip`). A card rounds the root, or only the card
 * inside the content, whose radius the root then takes; an inset list rounds its
 * wrapper and the first and last rows. What a DOM read cannot say is
 * whether the action colour is PAINTED outside that curve, so this reads pixels:
 * the box is shot, decoded in the page (the suite has no PNG decoder, see
 * support/painted.ts), and every pixel of the corner square that lies outside
 * the arc must not be the action's colour. The same shot must show the action
 * inside the box, or the check would pass on a row that never moved.
 *
 * The drag is the mouse: on the web a row follows a mouse as it follows a finger
 * (the lab brief), and the mouse needs no CDP touch session.
 */

test.use({ viewport: { width: 390, height: 844 } })

test.skip(
  ({ browserName }) => browserName !== "chromium",
  "the mouse drag runs on the desktop profile",
)

const RADIUS = 16 // rounded-2xl

type Corner = "top-right" | "bottom-right"

/** Action-coloured pixels in the box, and those outside the corner's arc. */
async function actionPixels(box: Locator, colour: string, corner: Corner) {
  const shot = await box.screenshot()
  return box.page().evaluate(
    async ([base64, rgb, at, radius]) => {
      const img = new Image()
      img.src = `data:image/png;base64,${base64}`
      await img.decode()
      const canvas = document.createElement("canvas")
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const context = canvas.getContext("2d")
      if (!context) throw new Error("no 2d context")
      context.drawImage(img, 0, 0)
      const { data, width, height } = context.getImageData(
        0,
        0,
        canvas.width,
        canvas.height,
      )
      //the computed colour may be any syntax (oklch here): let a canvas resolve it
      const swatch = document.createElement("canvas").getContext("2d")
      if (!swatch) throw new Error("no 2d context")
      swatch.fillStyle = rgb as string
      swatch.fillRect(0, 0, 1, 1)
      const [r, g, b] = swatch.getImageData(0, 0, 1, 1).data
      const isAction = (i: number) =>
        Math.abs(data[i] - r) < 40 &&
        Math.abs(data[i + 1] - g) < 40 &&
        Math.abs(data[i + 2] - b) < 40
      //a radius over half the box is scaled down to fit (CSS Backgrounds §5.5)
      const rad = Math.min(
        (radius as number) * window.devicePixelRatio,
        width / 2,
        height / 2,
      )
      //the centre of the corner's arc, in shot pixels
      const cx = width - rad
      const cy = at === "top-right" ? rad : height - rad
      let inside = 0
      let outsideArc = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          if (!isAction(i)) continue
          inside++
          const inCornerSquare =
            x >= cx && (at === "top-right" ? y <= cy : y >= cy)
          //one pixel of slack for the anti-aliased edge of the curve
          if (inCornerSquare && Math.hypot(x - cx, y - cy) > rad + 1)
            outsideArc++
        }
      }
      return { inside, outsideArc }
    },
    [shot.toString("base64"), colour, corner, RADIUS] as const,
  )
}

async function open(page: Page) {
  await page.goto("/lab/swipeable")
  await awaitClientHandover(page)
}

/** Press on the row's right side and drag it left, holding the button. */
async function dragLeft(page: Page, row: Locator, by: number) {
  const b = await row.boundingBox()
  if (!b) throw new Error("the row has no layout box")
  const y = b.y + b.height / 2
  await page.mouse.move(b.x + b.width - 30, y)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width - 30 - by, y, { steps: 8 })
  //let the spring catch up with the pointer before the shot
  await page.waitForTimeout(200)
}

async function expectClipped(
  box: Locator,
  row: Locator,
  action: Locator,
  corner: Corner,
) {
  const page = box.page()
  await box.scrollIntoViewIfNeeded()
  const colour = await action.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  )

  const rest = await actionPixels(box, colour, corner)
  expect(rest.inside, "at rest no action colour shows").toBe(0)

  await dragLeft(page, row, 50)
  const mid = await actionPixels(box, colour, corner)
  expect(mid.inside, "mid-swipe the action shows").toBeGreaterThan(0)
  expect(
    mid.outsideArc,
    "mid-swipe the action stays inside the corner",
  ).toBe(0)

  await page.mouse.up()
  await expect
    .poll(() => row.evaluate((el) => getComputedStyle(el).transform))
    .not.toBe("none")
  await page.waitForTimeout(600)
  const opened = await actionPixels(box, colour, corner)
  expect(opened.inside, "open, the action shows").toBeGreaterThan(0)
  expect(
    opened.outsideArc,
    "open, the action stays inside the corner",
  ).toBe(0)
}

test("a rounded card clips its actions to its corners", async ({
  page,
}) => {
  await open(page)
  const box = page.locator('[data-lab-rounded="card"]')
  await expectClipped(
    box,
    box.locator("[data-swipeable-content]"),
    page.getByRole("button", { name: "Delete the card" }),
    "top-right",
  )
})

//the radius only on the card inside the content: the root is square, so the clip
//has to come from the card, or the action shows square outside its silhouette
test("a card rounded on its content clips its actions to the card's corners", async ({
  page,
}) => {
  await open(page)
  const box = page.locator('[data-lab-rounded="content-card"]')
  await expectClipped(
    box,
    box.locator("[data-swipeable-content]"),
    page.getByRole("button", { name: "Delete the content card" }),
    "top-right",
  )
})

test("an inset list clips the first row's actions to its top corner", async ({
  page,
}) => {
  await open(page)
  const box = page.locator('[data-lab-rounded="inset"]')
  await expectClipped(
    box,
    box.locator("[data-swipeable-content]").first(),
    page.getByRole("button", { name: "Delete the first inset row" }),
    "top-right",
  )
})

test("an inset list clips the last row's actions to its bottom corner", async ({
  page,
}) => {
  await open(page)
  const box = page.locator('[data-lab-rounded="inset"]')
  await expectClipped(
    box,
    box.locator("[data-swipeable-content]").last(),
    page.getByRole("button", { name: "Delete the third inset row" }),
    "bottom-right",
  )
})
