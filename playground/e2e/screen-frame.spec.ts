import { expect, test } from "@playwright/test"

/*
 * A page's root fills the screen without saying so.
 *
 * The shell always gave every route a full-screen frame, but a flex child does not
 * grow on its own — so every page opened with `<ScrollView fill>` and forgetting the
 * prop produced a scroller sized to its content that silently would not scroll. Apps
 * then papered over it with their own wrapper: the playground's `Page` carried a
 * `<View fill className="w-full">` that measured as the exact same box as the frame it
 * sat in. `styles/screen.css` stretches the frame's only child instead.
 *
 * This is a computed-layout claim, so it can only be tested in an engine — jsdom
 * resolves no heights at all and would pass whatever the CSS said.
 */

test.describe("the screen frame", () => {
  test("stretches a page's root, so `fill` is not needed there", async ({
    page,
  }) => {
    await page.goto("/lab/view-scroll")
    const frame = page.locator("[data-adaptv-screen]")
    await frame.waitFor()

    const measured = await frame.evaluate((el) => {
      const root = el.firstElementChild as HTMLElement
      const cs = getComputedStyle(root)
      return {
        children: el.childElementCount,
        declaresFill: root.className.includes("flex-1"),
        grow: cs.flexGrow,
        minHeight: cs.minHeight,
        frameHeight: Math.round(el.getBoundingClientRect().height),
        rootHeight: Math.round(root.getBoundingClientRect().height),
        scrolls: root.scrollHeight > root.clientHeight,
      }
    })

    expect(measured.children, "the rule only applies to an only child").toBe(1)
    expect(
      measured.declaresFill,
      "the page must NOT be carrying flex-1 itself — that is the boilerplate this removes",
    ).toBe(false)
    expect(measured.grow).toBe("1")
    //growing without this makes a ScrollView size to its content and scroll nothing
    expect(measured.minHeight).toBe("0px")
    expect(measured.rootHeight).toBe(measured.frameHeight)
    expect(measured.scrolls, "and it must actually scroll").toBe(true)
  })

  test("leaves a multi-root page exactly as it was", async ({ page }) => {
    /*
     * The alternative designs both break this case: `> *` would stretch every sibling
     * and they would fight; a single-cell grid on the frame would stack them on top of
     * each other. `:only-child` cannot silently rearrange an existing page, and that
     * is the whole reason it was chosen — so it is worth a test of its own.
     */
    await page.goto("/lab/view-scroll")
    const frame = page.locator("[data-adaptv-screen]")
    await frame.waitFor()

    const grows = await frame.evaluate((el) => {
      const sibling = document.createElement("div")
      sibling.style.height = "40px"
      el.append(sibling)
      const first = getComputedStyle(el.firstElementChild as HTMLElement).flexGrow
      const second = getComputedStyle(sibling).flexGrow
      sibling.remove()
      return { first, second }
    })

    expect(grows.first, "the rule must stop applying once there are two").toBe(
      "0",
    )
    expect(grows.second).toBe("0")
  })

  test("a root that deliberately does not fill can opt out with one class", async ({
    page,
  }) => {
    /*
     * ARCHITECTURE.md §1.3 left this open: does a route that wants a NON-filling root
     * need a shell prop? It does not — the stretch lives in `adaptv.components` and a
     * Tailwind utility compiles into `utilities`, which outranks it. So the escape
     * hatch is a class the consumer already knows, with no new API and no `!important`.
     *
     * The rule is injected rather than added as a className, because Tailwind's JIT
     * only emits classes it finds in the SOURCE scan and nothing in the playground
     * writes `flex-none` — adding the class to the DOM changes nothing at all, and the
     * first version of this test read that as a broken escape hatch. Injecting into the
     * real `utilities` layer is what a consumer writing the class in their own source
     * would get, and it is the layer ORDER that is actually under test here.
     */
    await page.goto("/lab/view-scroll")
    const frame = page.locator("[data-adaptv-screen]")
    await frame.waitFor()

    await page.addStyleTag({
      content: "@layer utilities { .flex-none { flex: none } }",
    })

    const grow = await frame.evaluate((el) => {
      const root = el.firstElementChild as HTMLElement
      root.classList.add("flex-none")
      const value = getComputedStyle(root).flexGrow
      root.classList.remove("flex-none")
      return value
    })
    expect(
      grow,
      "a utility must beat the shell's stretch, or the layer order is not load-bearing",
    ).toBe("0")
  })
})
