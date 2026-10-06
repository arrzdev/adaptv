import type { Browser, Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Divider — a hairline rule that is one DEVICE pixel, a border rather than a
 * background, and says what it is. All three are assertable headlessly:
 *
 *   - the width: `styles/divider.css` keeps a whole `1px` border and scales the
 *     element by `1 / dpr` with a transform from a `min-resolution` ladder, so at
 *     every density the rule's bounding box (which is AFTER the transform) times
 *     `devicePixelRatio` is one. A sub-pixel border WIDTH was the first cut and
 *     both engines got it wrong — Chromium rounds it up to a CSS pixel, WebKit
 *     floors a third at 3x to nothing — which is why the box, not the border
 *     width, is what is judged. A context per density proves the ladder, the
 *     page's own readout (measured after mount) is read as a tester would read it
 *     on a device, and a strip of the page is scanned for what the engine actually
 *     PAINTED;
 *   - the border: under `forced-colors: active` an author background is dropped
 *     to `Canvas` while a border is kept and recoloured — so the width and style
 *     are still there with the emulation on;
 *   - the semantics: `role="separator"`, `aria-orientation` only when vertical,
 *     `role="none"` when decorative.
 *
 * The clip probe at the bottom is not a Divider at all. It is two rounded,
 * `overflow-hidden` boxes with a filled child, one composited and one not, kept
 * here because the hairline work is where WebKit's "a composited child escapes a
 * rounded parent" quirk would first be noticed. The screenshots are for a human;
 * the corner pixels are read back in-page (a canvas, no PNG library in the
 * playground's deps) and printed, not asserted.
 */

/*
 * Without the hydration gate (`awaitClientHandover`, e2e/support/hydrated.ts) the
 * readouts are read empty: the rules are server-rendered, but the readouts are
 * written from a `useEffect` after mount, and the hairline number is exactly what
 * the density tests exist to check.
 */

async function openDivider(page: Page) {
  await page.goto("/lab/divider")
  await awaitClientHandover(page)
  // `attached`, not the default `visible`: Playwright calls a box with a zero-height
  // bounding rect hidden, and a one-device-pixel rule at 3x is 0.33 CSS px tall — WebKit
  // rounds that rect to 0 and the default wait never resolves
  await page.getByTestId("divider-h").waitFor({ state: "attached" })
  // the readouts land one effect after mount; wait for the first so every
  // measurement below is taken from a hydrated page
  await expect(page.getByTestId("divider-readout")).toContainText(
    "device px",
  )
}

/** The computed styles a hairline is judged on, plus the density they were read at. */
function measure(rule: Locator) {
  return rule.evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      dpr: window.devicePixelRatio,
      borderTopWidth: s.borderTopWidth,
      borderBottomWidth: s.borderBottomWidth,
      borderLeftWidth: s.borderLeftWidth,
      borderTopStyle: s.borderTopStyle,
      borderTopColor: s.borderTopColor,
      height: s.height,
      boxHeight: el.getBoundingClientRect().height,
      clientHeight: el.clientHeight,
      offsetHeight: (el as HTMLElement).offsetHeight,
    }
  })
}

/**
 * What the engine actually PAINTED: a strip of the page around the horizontal rule,
 * decoded in-page on a canvas (no PNG reader in the playground's deps), scanned one
 * column down the middle. Every row whose colour differs from the top row is a
 * painted row of the rule, and the strip is captured at the context's density, so
 * the count is in device pixels — the number the whole component is about.
 */
async function paintedRows(page: Page, rule: Locator) {
  // a page screenshot's clip is viewport-relative, and the rule sits below the
  // brief; scrolled by hand because Playwright's own scrollIntoViewIfNeeded
  // waits for "visible", which a zero-height box never is
  await rule.evaluate((el) => el.scrollIntoView({ block: "center" }))
  const box = await rule.boundingBox()
  if (!box) throw new Error("the rule has no box")
  const clip = {
    x: box.x,
    y: Math.max(0, box.y - 3),
    width: 40,
    height: 7,
  }
  const png = await page.screenshot({ clip })
  return page.evaluate(async (b64) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const canvas = document.createElement("canvas")
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("no 2d context")
    ctx.drawImage(img, 0, 0)
    const x = img.width >> 1
    const column = ctx.getImageData(x, 0, 1, img.height).data
    const rows: string[] = []
    for (let y = 0; y < img.height; y += 1) {
      const i = y * 4
      rows.push(`${column[i]},${column[i + 1]},${column[i + 2]}`)
    }
    const background = rows[0]
    return {
      stripDevicePx: img.height,
      painted: rows.filter((row) => row !== background).length,
      rows,
    }
  }, png.toString("base64"))
}

/** The page's own readout: `dpr 3 · border 1px · drawn 0.3333px · 1.00 device px · 3dppx`. */
function parseReadout(text: string) {
  const m =
    /^dpr (?<dpr>[\d.]+) · border (?<border>[\d.]+)px · drawn (?<drawn>[\d.]+)px · (?<device>[\d.]+) device px · (?<bucket>[\d.]+dppx)$/.exec(
      text,
    )
  if (!m?.groups) throw new Error(`unreadable hairline readout: "${text}"`)
  return {
    dpr: Number(m.groups.dpr),
    border: Number(m.groups.border),
    drawn: Number(m.groups.drawn),
    device: m.groups.device,
    bucket: m.groups.bucket,
  }
}

/** One device pixel, whatever the density: the drawn (transformed) box times the dpr is one. */
function expectOneDevicePixel(cssHeight: number, dpr: number) {
  expect(Math.abs(cssHeight * dpr - 1)).toBeLessThan(0.02)
}

/**
 * A fresh context at a given density. The webkit project is an iPhone 13 (dpr 3)
 * and chromium a desktop (dpr 1), so the only way to test each bucket on BOTH
 * engines is a context that sets the factor itself. `before` runs on the page
 * ahead of navigation, for an emulation the stylesheet must see at first paint.
 */
async function withDensity<T>(
  browser: Browser,
  baseURL: string | undefined,
  deviceScaleFactor: number,
  run: (page: Page) => Promise<T>,
  before?: (page: Page) => Promise<void>,
): Promise<T> {
  const context = await browser.newContext({
    baseURL,
    deviceScaleFactor,
    viewport: { width: 390, height: 844 },
  })
  try {
    const page = await context.newPage()
    await before?.(page)
    await openDivider(page)
    return await run(page)
  } finally {
    await context.close()
  }
}

test.describe("Divider", () => {
  test.beforeEach(async ({ page }) => {
    await openDivider(page)
  })

  test("horizontal: a separator whose only box is its top border", async ({
    page,
  }) => {
    const rule = page.getByTestId("divider-h")
    await expect(rule).toHaveAttribute("role", "separator")
    await expect(rule).toHaveAttribute("data-adaptv", "divider")
    // horizontal is the ARIA default and is left unsaid
    expect(await rule.getAttribute("aria-orientation")).toBeNull()
    expect(await rule.getAttribute("data-orientation")).toBeNull()

    const m = await measure(rule)
    // the width itself is judged per density below; here, the edges
    expect(m.borderBottomWidth).toBe("0px")
    expect(m.borderLeftWidth).toBe("0px")
    expect(m.borderTopStyle).toBe("solid")
    // no content box at all: the rule IS the border, a whole CSS pixel of it. The
    // preflight puts every element on `box-sizing: border-box`, so the resolved
    // `height` is that 1px and the content box (`clientHeight`) is 0. The bounding
    // box is the transformed one — 1px scaled by 1 / dpr — judged per density below.
    expect(m.borderTopWidth).toBe("1px")
    expect(m.height).toBe("1px")
    expect(m.clientHeight).toBe(0)
    expect(m.offsetHeight).toBe(1)
    console.log(
      `[divider-h] dpr ${m.dpr} borderTopWidth ${m.borderTopWidth} height ${m.height} boxHeight ${m.boxHeight} offsetHeight ${m.offsetHeight}`,
    )
  })

  test("vertical: says so, rules on the leading edge, and stretches to the row @tailwind", async ({
    page,
  }) => {
    const rule = page.getByTestId("divider-v")
    await expect(rule).toHaveAttribute("role", "separator")
    await expect(rule).toHaveAttribute("aria-orientation", "vertical")
    await expect(rule).toHaveAttribute("data-orientation", "vertical")

    const m = await measure(rule)
    // the same hairline, on the other edge
    expect(m.borderLeftWidth).toBe("1px")
    expect(m.borderTopWidth).toBe("0px")
    // and scaled the other way: the drawn width is one device pixel
    const ruleBoxWidth = (await rule.boundingBox())?.width ?? 0
    expect(Math.abs(ruleBoxWidth * m.dpr - 1)).toBeLessThan(0.02)

    // align-self: stretch — the row's height, without the consumer naming it
    const row = page.getByTestId("divider-v-row")
    const ruleBox = await rule.boundingBox()
    const rowBox = await row.boundingBox()
    expect(ruleBox).not.toBeNull()
    expect(rowBox).not.toBeNull()
    expect(rowBox?.height).toBeGreaterThan(20)
    expect(
      Math.abs((ruleBox?.height ?? 0) - (rowBox?.height ?? 0)),
    ).toBeLessThan(0.5)
  })

  test("decorative: seen, not announced", async ({ page }) => {
    const rule = page.getByTestId("divider-decorative")
    await expect(rule).toHaveAttribute("role", "none")
    expect(await rule.getAttribute("aria-orientation")).toBeNull()
    // still the same hairline, just a silent one
    const m = await measure(rule)
    const horizontal = await measure(page.getByTestId("divider-h"))
    expect(m.borderTopWidth).toBe(horizontal.borderTopWidth)
  })

  test("colour: a border-* utility on className repaints the rule @tailwind", async ({
    page,
  }) => {
    const plain = await measure(page.getByTestId("divider-h"))
    const red = await measure(page.getByTestId("divider-colour"))
    expect(red.borderTopColor).not.toBe(plain.borderTopColor)
    // ...and only the colour: the width is the stylesheet's, not the class's
    expect(red.borderTopWidth).toBe(plain.borderTopWidth)
  })

  test("readout: the page measures what the test measures", async ({
    page,
  }) => {
    const readout = parseReadout(
      (await page.getByTestId("divider-readout").textContent()) ?? "",
    )
    const m = await measure(page.getByTestId("divider-h"))
    expect(readout.dpr).toBe(m.dpr)
    expect(readout.border).toBe(1)
    expect(Math.abs(readout.drawn - m.boxHeight)).toBeLessThan(0.001)
  })

  test("clip probe: both boxes are rounded; the corner pixels are read back @tailwind", async ({
    page,
  }, testInfo) => {
    const composited = page.getByTestId("clip-probe-composited")
    const plain = page.getByTestId("clip-probe-plain")
    const child = page.getByTestId("clip-probe-child")

    const radius = (box: Locator) =>
      box.evaluate((el) => getComputedStyle(el).borderRadius)
    expect(await radius(composited)).toBe("16px")
    expect(await radius(plain)).toBe("16px")
    expect(
      await child.evaluate((el) => getComputedStyle(el).transform),
    ).not.toBe("none")
    await expect(page.getByTestId("clip-probe-readout")).toContainText(
      "composited radius 16px · plain radius 16px",
    )

    // for a human: two PNGs next to the trace
    const shots = {
      composited: await composited.screenshot({
        path: testInfo.outputPath("clip-probe-composited.png"),
      }),
      plain: await plain.screenshot({
        path: testInfo.outputPath("clip-probe-plain.png"),
      }),
    }

    // for the report: the top-left pixel (outside a 16px radius, so it should be
    // the page behind the box) and the centre (the child's fill), decoded by the
    // page itself on a canvas — the playground has no PNG reader in its deps.
    // Printed and annotated, not asserted: the probe is a question, not a claim.
    const readPixels = (png: Buffer) =>
      page.evaluate(async (b64) => {
        const img = new Image()
        img.src = `data:image/png;base64,${b64}`
        await img.decode()
        const canvas = document.createElement("canvas")
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("no 2d context")
        ctx.drawImage(img, 0, 0)
        const at = (x: number, y: number) =>
          Array.from(ctx.getImageData(x, y, 1, 1).data)
        return {
          width: img.width,
          height: img.height,
          corner: at(0, 0),
          centre: at(img.width >> 1, img.height >> 1),
        }
      }, png.toString("base64"))

    const pixels = {
      composited: await readPixels(shots.composited),
      plain: await readPixels(shots.plain),
    }
    const line = `[clip-probe ${testInfo.project.name}] ${JSON.stringify(pixels)}`
    console.log(line)
    testInfo.annotations.push({ type: "clip-probe", description: line })
    // the one thing that IS a claim: the decode worked and gave RGBA
    expect(pixels.composited.corner).toHaveLength(4)
    expect(pixels.plain.corner).toHaveLength(4)
  })
})

/*
 * The ladder, per engine, as measured by this spec on 2026-09-02 (Playwright
 * 1.61: chromium desktop, webkit-2311), FIRST with a sub-pixel border width and
 * then with the scaled 1px border that shipped:
 *
 *   border width  chromium 2x → 1px (2 device rows), 3x → 1px (3 rows): Chromium
 *                 rounds ANY border width between 0 and 1 CSS px up to 1 CSS px at
 *                 style time, whatever the device scale factor.
 *                 webkit 3x → 0px (0 rows): `calc(1px / 3)` is stored as a
 *                 LayoutUnit of 21/64 = 0.328px, and 0.328 × 3 floors to zero.
 *   scaled 1px    one painted device row at 1x, 2x and 3x on both engines — the
 *                 assertion below. Fractional densities are not asserted here: the
 *                 engines snap a 1px border DOWN to whole device pixels first
 *                 (0.761905px at 2.625x on webkit and on the Android WebView, but
 *                 an unsnapped 1px under chromium's headless emulation), which is
 *                 why the scale is 1 / floor(dpr) and why the Pixel emulator's own
 *                 screenshot, not this spec, is where 2.625x is judged.
 */
test.describe("Divider at each density", () => {
  for (const [dpr, bucket] of [
    [1, "1dppx"],
    [2, "2dppx"],
    [3, "3dppx"],
  ] as const) {
    test(`dpr ${dpr}: the ${bucket} step gives one device pixel`, async ({
      browser,
      baseURL,
      browserName,
    }) => {
      const result = await withDensity(
        browser,
        baseURL,
        dpr,
        async (page) => {
          const rule = page.getByTestId("divider-h")
          const text =
            (await page.getByTestId("divider-readout").textContent()) ?? ""
          const m = await measure(rule)
          const paint = await paintedRows(page, rule)
          return { text, readout: parseReadout(text), m, paint }
        },
      )
      console.log(
        `[divider-density ${browserName}] ${result.text} · computed ${result.m.borderTopWidth} · box ${result.m.boxHeight}px · painted ${result.paint.painted}/${result.paint.stripDevicePx} device rows`,
      )

      expect(result.m.dpr).toBe(dpr)
      expect(result.readout.dpr).toBe(dpr)
      expect(result.readout.bucket).toBe(bucket)
      // the border is a whole CSS pixel on every density: the width is never what thins
      expect(result.m.borderTopWidth).toBe("1px")
      // the drawn box, straight from the engine, is one device pixel
      expectOneDevicePixel(result.m.boxHeight, dpr)
      // and the page's own arithmetic, as a tester reads it on a device
      expect(result.readout.device).toBe("1.00")
      expect(Math.abs(result.readout.drawn * dpr - 1)).toBeLessThan(0.02)
      // and what was drawn: exactly one device-pixel row
      expect(result.paint.painted).toBe(1)
    })
  }
})

test.describe("Divider under forced colours", () => {
  test("the rule is a border, so it survives", async ({
    browser,
    baseURL,
  }) => {
    // at 1x, where both engines agree on the width, so the only variable is the
    // forced palette; emulated BEFORE navigation so the stylesheet is answered
    // at first paint
    const result = await withDensity(
      browser,
      baseURL,
      1,
      async (page) => {
        const probe = await page.evaluate(() => ({
          forcedColors: matchMedia("(forced-colors: active)").matches,
          // WebKit does not implement the property; a read there is just ""
          forcedColorAdjust: CSS.supports("forced-color-adjust", "auto")
            ? getComputedStyle(document.body).forcedColorAdjust
            : "unsupported",
        }))
        const m = await measure(page.getByTestId("divider-h"))
        return { probe, m }
      },
      (page) => page.emulateMedia({ forcedColors: "active" }),
    )
    const line = `[divider-forced-colors] active=${result.probe.forcedColors} forced-color-adjust=${result.probe.forcedColorAdjust} borderTopWidth=${result.m.borderTopWidth} style=${result.m.borderTopStyle} color=${result.m.borderTopColor}`
    console.log(line)
    test
      .info()
      .annotations.push({ type: "forced-colors", description: line })

    // the emulation took, on this engine
    expect(result.probe.forcedColors).toBe(true)
    // a background would be gone; the border keeps its width and its style
    expect(result.m.borderTopWidth).toBe("1px")
    expect(result.m.borderTopStyle).toBe("solid")
  })
})
