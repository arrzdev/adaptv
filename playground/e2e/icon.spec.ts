import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Icon — an <svg> from any icon set, exposed correctly and sized with its text. Three
 * of its claims are assertable in a headless browser; the fourth, iOS Dynamic Type
 * actually GROWING an opted-in icon, needs the OS text-size setting and lives on the
 * page as live numbers for a simulator walk:
 *
 *   - exposure: a labelled icon is an image with that name and a decorative one is not
 *     in the tree at all. Asserted three ways — Playwright's role engine, its aria
 *     snapshot, and on chromium the browser's OWN accessibility tree over CDP, because
 *     the first two are Playwright's computation and the quirk is the engine's;
 *   - the default 1em box follows the font-size of the text around it;
 *   - `scaleWithSystem` is inert off iOS: the opted-in icon is the same box as the one
 *     that did not opt in, and carries no inline size;
 *   - with the iOS gate forced open, the REAL measurement yields a factor that is not a
 *     whole number, and the opted-in bell is its built size times that factor once —
 *     through a resize, back, an opt-out, and a StrictMode mount;
 *   - and `rtl:-scale-x-100` flips a glyph under dir=rtl only.
 */

async function openIcon(page: Page) {
  await page.goto("/lab/icon")
  //the readouts are written from effects after mount; without the gate they are read
  //as their SSR placeholders
  await awaitClientHandover(page)
  await expect(page.getByTestId("icon-inline")).toBeVisible()
}

/**
 * Icon reports a dropped role/aria-label with console.error in development, so a lab
 * page that misuses it — or hydrates with a mismatch — fails the spec, not later.
 */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("pageerror", (error) =>
    errors.push(`uncaught: ${String(error)}`),
  )
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  return errors
}

test.describe("Icon", () => {
  let errors: string[] = []

  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page)
    await openIcon(page)
  })

  test.afterEach(() => {
    expect(errors).toEqual([])
  })

  test("a labelled icon is an image with its name; a decorative one is not in the tree", async ({
    page,
  }) => {
    const exposure = page.getByTestId("icon-exposure")

    await expect(
      exposure.getByRole("img", { name: "Sync failed" }),
    ).toHaveCount(1)
    await expect(
      exposure.getByRole("img", { name: "Offline" }),
    ).toHaveCount(1)
    //exactly the two labelled ones — the star and the arrow in the button are hidden
    await expect(exposure.getByRole("img")).toHaveCount(2)
    //…while all four svgs ARE there, so the count above is not vacuous
    await expect(exposure.locator('svg[data-adaptv="icon"]')).toHaveCount(
      4,
    )

    //the icon-only control is named by the button, not by its glyph
    await expect(
      exposure.getByRole("button", { name: "Back" }),
    ).toHaveCount(1)

    const snapshot = await exposure.ariaSnapshot()
    console.log(`[icon-aria ${test.info().project.name}]\n${snapshot}`)
    expect(snapshot).toContain('img "Sync failed"')
    expect(snapshot).toContain('img "Offline"')
    expect(snapshot).toContain('button "Back"')
    //the decorative star leaves only its word behind
    expect(snapshot).toContain("Starred")
    expect(snapshot.match(/- img\b/g) ?? []).toHaveLength(2)

    const decorative = page.getByTestId("icon-decorative")
    await expect(decorative).toHaveAttribute("aria-hidden", "true")
    expect(await decorative.getAttribute("role")).toBeNull()
    const labelled = page.getByTestId("icon-labelled-alert")
    await expect(labelled).toHaveAttribute("role", "img")
    await expect(labelled).toHaveAttribute("aria-label", "Sync failed")
    expect(await labelled.getAttribute("aria-hidden")).toBeNull()
  })

  test("chromium's own accessibility tree agrees", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "CDP Accessibility is Chromium-only; WebKit's tree is read on the simulator",
    )
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("DOM.enable")
    await cdp.send("Accessibility.enable")
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 })

    const axOf = async (testId: string) => {
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: `[data-testid="${testId}"]`,
      })
      expect(nodeId, `${testId} is in the DOM`).toBeGreaterThan(0)
      const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
        nodeId,
        fetchRelatives: false,
      })
      const node = nodes[0]
      return {
        ignored: node?.ignored ?? null,
        role: node?.role?.value ?? null,
        name: node?.name?.value ?? null,
        why: (node?.ignoredReasons ?? []).map((r) => r.name).join(","),
      }
    }

    const decorative = await axOf("icon-decorative")
    const inButton = await axOf("icon-in-button")
    const alert = await axOf("icon-labelled-alert")
    const offline = await axOf("icon-labelled-offline")
    console.log(
      `[icon-ax chromium] ${JSON.stringify({ decorative, inButton, alert, offline })}`,
    )

    expect(decorative.ignored).toBe(true)
    expect(inButton.ignored).toBe(true)
    expect(alert.ignored).toBe(false)
    expect(alert.role).toBe("image")
    expect(alert.name).toBe("Sync failed")
    expect(offline.ignored).toBe(false)
    expect(offline.role).toBe("image")
    expect(offline.name).toBe("Offline")
  })

  test("the default 1em box is the font-size of the text around it", async ({
    page,
  }) => {
    const sizes: number[] = []
    for (const key of ["xs", "base", "2xl", "4xl"]) {
      const font = await page
        .getByTestId(`inline-text-${key}`)
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
      const box = await page
        .getByTestId(`inline-icon-${key}`)
        .boundingBox()
      expect(box, `inline-icon-${key} has a box`).not.toBeNull()
      console.log(
        `[icon-1em ${test.info().project.name}] text-${key} font ${font}px · icon ${box?.width}×${box?.height}`,
      )
      expect(Math.abs((box?.width ?? 0) - font)).toBeLessThan(0.5)
      expect(Math.abs((box?.height ?? 0) - font)).toBeLessThan(0.5)
      sizes.push(font)
    }
    //the four steps really are four different sizes, so "follows" is not vacuous
    expect(new Set(sizes).size).toBe(4)
    expect(sizes[3]).toBeGreaterThan(sizes[0] * 2)

    //and the page's own readout says the same thing a tester reads on a device
    await expect(page.getByText(/^font 36px · icon 36×36px$/)).toHaveCount(
      1,
    )
  })

  test("scaleWithSystem is inert off iOS: the opted-in icon keeps its built box", async ({
    page,
  }) => {
    const plain = page.getByTestId("dt-icon-plain")
    const scaled = page.getByTestId("dt-icon-scaled")

    const gate = await page.evaluate(() =>
      CSS.supports("-webkit-touch-callout", "none"),
    )
    const plainBox = await plain.boundingBox()
    const scaledBox = await scaled.boundingBox()
    const inline = await scaled.evaluate((el) => ({
      width: (el as SVGSVGElement).style.width,
      height: (el as SVGSVGElement).style.height,
    }))
    console.log(
      `[icon-dt ${test.info().project.name}] touch-callout=${gate} plain ${plainBox?.width}×${plainBox?.height} scaled ${scaledBox?.width}×${scaledBox?.height} inline ${JSON.stringify(inline)}`,
    )

    //the premise: this engine is not iOS WebKit, so the measured factor is 1
    expect(gate).toBe(false)
    await expect(scaled).toHaveAttribute("data-scale-with-system", "")
    expect(await plain.getAttribute("data-scale-with-system")).toBeNull()
    //size-5, untouched, on both
    expect(plainBox?.width).toBe(20)
    expect(scaledBox?.width).toBe(20)
    expect(scaledBox?.height).toBe(20)
    //and not by coincidence: nothing was written inline
    expect(inline).toEqual({ width: "", height: "" })
    await expect(page.getByText("1.00×", { exact: true })).toHaveCount(1)
  })

  test("rtl:-scale-x-100 flips a glyph under dir=rtl, and only there", async ({
    page,
  }) => {
    const scaleOf = (id: string) =>
      page.getByTestId(id).evaluate((el) => getComputedStyle(el).scale)
    const ltrFlip = await scaleOf("rtl-ltr-flip")
    const rtlFlip = await scaleOf("rtl-rtl-flip")
    const rtlPlain = await scaleOf("rtl-rtl-plain")
    console.log(
      `[icon-rtl ${test.info().project.name}] ltr-flip=${ltrFlip} rtl-flip=${rtlFlip} rtl-plain=${rtlPlain}`,
    )
    expect(rtlFlip).toBe("-1 1")
    expect(ltrFlip).toBe("none")
    expect(rtlPlain).toBe("none")
  })
})

/*
 * iOS Dynamic Type with the gate forced open. `measureDynamicTypeScale` asks
 * `CSS.supports("-webkit-touch-callout", "none")` before it measures; answering yes
 * makes both engines run the REAL measurement (the `-apple-system-body` probe ÷ 17).
 * Neither desktop engine resolves the keyword to 17px, so the factor is a fraction
 * like the ones an iPhone produces, and an engine stores the length it is given
 * ROUNDED — the shape that multiplied a stale size on every re-run before the fix,
 * and that a factor of 2 hides.
 */
test.describe("Icon scaleWithSystem with the iOS gate forced open", () => {
  let errors: string[] = []

  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page)
    await page.addInitScript(() => {
      const supports = CSS.supports.bind(CSS)
      CSS.supports = ((property: string, value?: string) =>
        property === "-webkit-touch-callout" && value === "none"
          ? true
          : value === undefined
            ? supports(property)
            : supports(property, value)) as typeof CSS.supports
    })
  })

  test.afterEach(() => {
    expect(errors).toEqual([])
  })

  /** The factor both opted-in elements were multiplied by, read three ways. */
  async function readFactor(page: Page) {
    const measured = await page.evaluate(() => {
      const probe = document.createElement("span")
      probe.style.font = "-apple-system-body"
      document.body.append(probe)
      const px = Number.parseFloat(getComputedStyle(probe).fontSize)
      probe.remove()
      return {
        gate: CSS.supports("-webkit-touch-callout", "none"),
        factor: px / 17,
      }
    })
    const plainFont = await page
      .getByTestId("dt-text-plain")
      .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
    return { ...measured, textFactor: plainFont / 16 }
  }

  /** The bell's inline width as written and its laid-out box, in px. */
  function bell(page: Page) {
    return page.getByTestId("dt-icon-scaled").evaluate((el) => {
      const svg = el as SVGSVGElement
      return {
        inline: svg.style.width,
        height: svg.style.height,
        box: svg.getBoundingClientRect().width,
      }
    })
  }

  async function expectBell(page: Page, built: number, factor: number) {
    const want = built * factor
    //the inline value is stored rounded (4 decimals in Chromium, 6 in WebKit) and the
    //box snaps to a 1/64 px layout unit
    await expect
      .poll(async () =>
        Math.abs(Number.parseFloat((await bell(page)).inline) - want),
      )
      .toBeLessThan(0.001)
    const { box, height } = await bell(page)
    expect(Math.abs(Number.parseFloat(height) - want)).toBeLessThan(0.001)
    expect(Math.abs(box - want)).toBeLessThan(0.02)
  }

  test("multiplies the bell once by a factor that is not a whole number, through a resize and an opt-out", async ({
    page,
  }) => {
    await openIcon(page)
    const { gate, factor, textFactor } = await readFactor(page)
    console.log(
      `[icon-dt-forced ${test.info().project.name}] gate=${gate} factor=${factor} text=${textFactor} bell=${JSON.stringify(await bell(page))}`,
    )

    //the premise: the gate is open, the factor is not 1 and not a whole number, and
    //Text measured the very same factor
    expect(gate).toBe(true)
    expect(factor).not.toBe(1)
    expect(Number.isInteger(factor)).toBe(false)
    expect(Math.abs(textFactor - factor)).toBeLessThan(0.001)

    //the bell beside the plain row did not opt in and keeps its class size
    const plainBox = await page.getByTestId("dt-icon-plain").boundingBox()
    expect(plainBox?.width).toBe(20)

    //size-5 × factor, not × factor²
    await expectBell(page, 20, factor)

    //a new class re-measures from the class size…
    await page.getByTestId("dt-toggle-size").click()
    await expectBell(page, 24, factor)
    //…and going back does not compound
    await page.getByTestId("dt-toggle-size").click()
    await expectBell(page, 20, factor)

    //opting out leaves nothing behind
    await page.getByTestId("dt-toggle-scale").click()
    await expect.poll(async () => (await bell(page)).inline).toBe("")
    expect((await bell(page)).height).toBe("")
    expect((await bell(page)).box).toBe(20)
  })

  test("a client-side navigation mounts it under StrictMode at the factor once", async ({
    page,
  }) => {
    //A document load HYDRATES the page, and React 19 does not replay the effects of a
    //hydrated component under StrictMode; a client navigation MOUNTS it, and does.
    //Only this path runs the scale effect twice on mount.
    await page.goto("/lab")
    await awaitClientHandover(page)
    await page.locator('a[href="/lab/icon"]').click()
    await expect(page).toHaveURL(/\/lab\/icon$/)
    await expect(page.getByTestId("dt-icon-scaled")).toBeVisible()

    const { factor } = await readFactor(page)
    console.log(
      `[icon-dt-forced-nav ${test.info().project.name}] factor=${factor} bell=${JSON.stringify(await bell(page))}`,
    )
    expect(Number.isInteger(factor)).toBe(false)
    await expectBell(page, 20, factor)
  })
})
