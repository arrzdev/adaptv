import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The handle's MOUSE drag gives the gesture arbiter back.
 *
 * A trackpad on an iPad or the mouse of a touchscreen laptop drags the sheet by
 * its handle, and that path claims adaptv's shared gesture arbiter at
 * pointerdown. The drawer used to keep holding it once the drag was over — even
 * after the drag closed the sheet — so the next edge swipe pre-empted a finished
 * drag and a row swipe, which ranks below a drawer drag, was refused. Nothing on
 * screen shows who holds the arbiter, so this reads it: the page's own
 * `gesture-controller` module, imported by the exact URL the dev server served it
 * at, is the same instance the drawer claims through. The premise (the drawer
 * DOES hold it mid-drag) proves that, so a different instance cannot pass as
 * "released".
 *
 * Mouse, not touch: the whole-sheet touch drag is a different code path, pinned
 * by drawer-motion.spec.ts. A mouse pointer runs on both engines.
 */

test.use({
  hasTouch: false,
  isMobile: false,
  viewport: { width: 390, height: 844 },
})
test.describe.configure({ mode: "serial" })

const BUTTON = "Open basic drawer"
const PANEL = "[data-pwa-drawer]"
//the panel's visible sheet, then the handle region at its top
const HANDLE = `${PANEL} > *:first-child > *:first-child`

/** Who holds the arbiter right now, read through the module instance the app itself loaded. */
function arbiterHolder(page: Page) {
  return page.evaluate(async () => {
    //the dev server serves the linked framework source at one /@fs URL per file, and the
    //browser keeps one module per URL. The resource timeline is capped (250 entries) well
    //short of a dev page's module count, so the URL is built from the client entry, which
    //is among the first few loaded, rather than searched for.
    const entry = performance
      .getEntriesByType("resource")
      .map((resource) => resource.name)
      .find((name) => /\/src\/routes\/client-entry\.tsx$/.test(name))
    if (!entry) throw new Error("the adaptv client entry was never loaded")
    const url = entry.replace(
      /routes\/client-entry\.tsx$/,
      "capabilities/gesture-controller.ts",
    )
    const arbiter = await import(/* @vite-ignore */ url)
    return {
      holder: arbiter.gestureController.getCaptured() as string | null,
      scrollBlocked:
        arbiter.gestureController.isScrollBlocked() as boolean,
    }
  })
}

function readTranslateY(page: Page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const t = getComputedStyle(el).transform
    if (!t || t === "none") return 0
    return new DOMMatrixReadOnly(t).m42
  }, PANEL)
}

async function openSheet(page: Page) {
  await page.getByRole("button", { name: BUTTON }).first().click()
  await page.locator(PANEL).waitFor({ state: "attached" })
  await expect
    .poll(async () => Math.round((await readTranslateY(page)) ?? -1), {
      timeout: 4000,
    })
    .toBe(0)
}

/** Press the handle, drag it `dy` down, and hold still before letting go. */
async function dragHandle(page: Page, dy: number, holdMs: number) {
  const box = await page.locator(HANDLE).boundingBox()
  if (!box) throw new Error("the drawer handle is not on screen")
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + dy, { steps: 8 })
  const during = await arbiterHolder(page)
  await page.waitForTimeout(holdMs)
  await page.mouse.up()
  return during
}

test.describe("the drawer handle's mouse drag", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/drawer")
    await awaitClientHandover(page)
    await page.getByRole("button", { name: BUTTON }).first().waitFor()
  })

  test("a short drag snaps the sheet back and frees the arbiter", async ({
    page,
  }) => {
    await openSheet(page)
    expect((await arbiterHolder(page)).holder).toBeNull()

    //held still, so the release reads as a slow short drag rather than a flick
    const during = await dragHandle(page, 24, 600)
    expect(
      during.holder,
      "premise: the drawer holds the arbiter mid-drag",
    ).not.toBeNull()
    expect(during.scrollBlocked).toBe(true)

    await expect
      .poll(async () => Math.round((await readTranslateY(page)) ?? -1), {
        timeout: 3000,
      })
      .toBe(0)
    await expect(page.locator(PANEL)).toBeVisible()
    expect(await arbiterHolder(page)).toEqual({
      holder: null,
      scrollBlocked: false,
    })
  })

  test("a drag that closes the sheet frees the arbiter", async ({
    page,
  }) => {
    await openSheet(page)
    const sheet = await page
      .locator(`${PANEL} > *:first-child`)
      .boundingBox()
    if (!sheet) throw new Error("the sheet is not on screen")

    const during = await dragHandle(page, sheet.height * 0.8, 0)
    expect(
      during.holder,
      "premise: the drawer holds the arbiter mid-drag",
    ).not.toBeNull()

    await expect(page.locator(PANEL)).toHaveCount(0, { timeout: 4000 })
    expect(await arbiterHolder(page)).toEqual({
      holder: null,
      scrollBlocked: false,
    })
  })
})
