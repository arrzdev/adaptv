import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * A closed row's tray is out of reach of the keyboard and of assistive tech.
 *
 * The trays park off-screen under a transform, which hides them from the eye
 * and from nothing else. The unit tests pin the `inert` attribute; happy-dom has
 * no tab order and no accessibility tree, so what that attribute DOES — a real
 * Tab walk skips the buttons, and the browser's own AX tree drops them — is only
 * provable in an engine. This is Chromium (the Android WebView engine); WebKit
 * and VoiceOver/TalkBack are a device walk.
 *
 * A desktop context on purpose: no touch, so the rotate guard stays down and the
 * mouse drives the row, and Tab is a real sequential-focus walk.
 */

const TRAY_BUTTON = /^(Archive|Delete) the \w+ row$/

/** Walk forward from the lab's `enabled` toggle, naming every stop. */
async function tabWalk(page: Page, stops: number) {
  await page.getByRole("button", { name: /^enabled:/ }).focus()
  const names: string[] = []
  for (let i = 0; i < stops; i += 1) {
    await page.keyboard.press("Tab")
    names.push(
      await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return "<body>"
        return (
          el.getAttribute("aria-label") ??
          (el.textContent ?? "").trim().slice(0, 40)
        )
      }),
    )
  }
  return names
}

/** Tray buttons the browser's accessibility tree still exposes, by name. */
async function exposedTrayButtons(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as {
    nodes: {
      ignored: boolean
      role?: { value: string }
      name?: { value: string }
    }[]
  }
  await cdp.detach()
  return nodes
    .filter(
      (n) =>
        !n.ignored &&
        n.role?.value === "button" &&
        TRAY_BUTTON.test(n.name?.value ?? ""),
    )
    .map((n) => n.name?.value)
    .sort()
}

test.describe("Swipeable · a parked tray", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "reads Chromium's accessibility tree over CDP",
  )

  test("is skipped by Tab and absent from the AX tree until its row opens, and again once it closes", async ({
    page,
  }) => {
    await page.goto("/lab/swipeable")
    await awaitClientHandover(page)
    const content = page.locator("[data-swipeable-content]").first()
    await content.scrollIntoViewIfNeeded()

    //closed: the walk leaves the rows without stopping in a tray
    const closedWalk = await tabWalk(page, 6)
    //soft, so a regression reports the walk AND the tree
    expect
      .soft(
        closedWalk.filter((name) => TRAY_BUTTON.test(name)),
        `Tab stopped in a closed tray: ${closedWalk.join(" → ")}`,
      )
      .toEqual([])
    expect(
      await exposedTrayButtons(page),
      "closed trays still in the accessibility tree",
    ).toEqual([])

    //open the first row's right tray with the mouse
    const box = await content.boundingBox()
    if (!box) throw new Error("the first row has no layout box")
    const y = box.y + box.height / 2
    const x = box.x + box.width / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 60, y, { steps: 12 })
    await page.mouse.up()
    await expect(page.locator("[data-lab-log] li").first()).toHaveText(
      /first opened \(right\)/,
    )

    //open: exactly that tray is in the tree and in the walk. Read the tree
    //first — Tab scrolls the page to what it focuses, and a scroll of the list
    //closes an open row by design, so a long walk would close it mid-test
    expect(await exposedTrayButtons(page)).toEqual([
      "Delete the first row",
    ])
    await page.getByRole("button", { name: /^enabled:/ }).focus()
    await page.keyboard.press("Tab")
    expect(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-label"),
      ),
    ).toBe("Delete the first row")

    //activate it from the keyboard: the action runs, the row closes, and focus
    //lands on the row's content instead of falling to <body>
    await page.keyboard.press("Enter")
    await expect(page.locator("[data-lab-log] li").first()).toHaveText(
      /first (closed|deleted)/,
    )
    expect(
      await page.evaluate(
        () =>
          document.activeElement ===
          document.querySelector("[data-swipeable-content]"),
      ),
      "focus must move to the closed row's content",
    ).toBe(true)
    await expect
      .poll(() => exposedTrayButtons(page), { timeout: 2000 })
      .toEqual([])
    const afterWalk = await tabWalk(page, 6)
    expect(
      afterWalk.filter((name) => TRAY_BUTTON.test(name)),
      afterWalk.join(" → "),
    ).toEqual([])
  })
})
