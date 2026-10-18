import { expect, test } from "@playwright/test"

//WCAG 2.4.7: a keyboard user sees where focus is. The docs search field sets
//`outline-none` on its input, so the field itself must draw the indicator.
test("the docs search field shows a focus indicator when tabbed to", async ({ page: tab }) => {
  await tab.setViewportSize({ width: 1280, height: 800 })
  await tab.goto("/docs/button")
  await tab.waitForLoadState("networkidle")

  const field = tab.getByPlaceholder("Search the docs")
  await expect(field).toBeVisible()
  for (let press = 0; press < 30; press++) {
    await tab.keyboard.press("Tab")
    if (await field.evaluate((input) => input === document.activeElement)) break
  }
  await expect(field).toBeFocused()

  //the indicator is an outline or a box-shadow on the input or on the label around it
  const indicators = await field.evaluate((input) =>
    [input, input.closest("label")].flatMap((node) => {
      if (!node) return []
      const style = getComputedStyle(node)
      const outline =
        style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0
      const shadow = style.boxShadow !== "none"
      return outline || shadow ? [`${node.tagName}: ${style.outline} ${style.boxShadow}`] : []
    }),
  )
  expect(indicators, "outline or box-shadow on the focused field").not.toEqual([])

  //the sidebar scrolls, so it clips: an outline drawn outside the field must still fit in it
  const clipped = await field.evaluate((input) => {
    const label = input.closest("label") as HTMLElement
    const style = getComputedStyle(label)
    const reach = Math.max(
      0,
      Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset),
    )
    const ring = label.getBoundingClientRect()
    const edges: string[] = []
    for (let node = label.parentElement; node; node = node.parentElement) {
      const { overflowX, overflowY } = getComputedStyle(node)
      if (overflowX === "visible" && overflowY === "visible") continue
      const box = node.getBoundingClientRect()
      if (ring.left - reach < box.left) edges.push("left")
      if (ring.top - reach < box.top) edges.push("top")
      if (ring.right + reach > box.right) edges.push("right")
      if (ring.bottom + reach > box.bottom) edges.push("bottom")
    }
    return edges
  })
  expect(clipped, "ring edges a scrolling ancestor cuts off").toEqual([])
})
