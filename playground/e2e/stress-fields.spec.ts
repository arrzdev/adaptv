import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Input & TextArea under stress — hostile content, hostile boxes, and the
 * native attributes the primitives forward untouched.
 *
 * Doctrine, same as `fields.spec.ts`: a DESKTOP context (`onSubmitKey` is gated on
 * `!isTouchDevice()`, so the webkit iPhone profile is pinned to no-touch here too),
 * the hydration gate in every `beforeEach`, no retries and no warm-ups. autoResize
 * writes its height from a scheduled frame, so no height is read directly: every
 * read goes through `settledHeight`, which waits frame by frame until the value
 * holds across two consecutive frames — a poll on a condition, never a sleep. The
 * premise is asserted before the claim: a fill actually landed, a root font-size
 * actually changed, the console counter was actually installed.
 *
 * What is measured, per field:
 * - the CAPPED field (`/lab/fields`'s own, rows=2 maxRows=5): 5 000 characters,
 *   200 newlines, RTL / CJK / emoji, a 200% root font, and the empty height after
 *   clearing. Its `clientHeight` is `rows × line-height` exactly, because the
 *   inner field is chromeless (`p-0`, no border) and the height is written in rem.
 * - the UNCAPPED probe (rows=2, default maxRows=100): 5 000 characters must fit
 *   without an inner scroll unless they need more than 100 rows, in which case the
 *   cap holds; 100 keystrokes at zero delay must land on the same height a fresh
 *   fill of the same text does.
 * - the ZERO-WIDTH probe: no `pageerror`, no `ResizeObserver loop` console error.
 *
 * Playwright's `fill()` refuses an element with no box, and the zero-width field
 * has none, so that one is edited the way a keystroke is — the prototype value
 * setter plus a bubbling `input` event, which is exactly what `TextArea.clear()`
 * does in the source — through `editLikeAKeystroke`.
 */

test.use({ hasTouch: false, isMobile: false })

const LOG = "[data-lab-log] li"
const logTexts = (page: Page) => page.locator(LOG).allInnerTexts()
const countLog = async (page: Page, pattern: RegExp) =>
  (await logTexts(page)).filter((t) => pattern.test(t)).length

const textbox = (page: Page, name: string) =>
  page.getByRole("textbox", { name, exact: true })

/** Poll a frame at a time until `clientHeight` holds across two consecutive frames. */
const settledHeight = (field: Locator) =>
  field.evaluate(async (el) => {
    const frame = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      )
    let last = -1
    for (let i = 0; i < 60; i += 1) {
      await frame()
      const next = el.clientHeight
      if (next === last) return next
      last = next
    }
    throw new Error(`the height never settled: last read ${last}`)
  })

const scrollHeightOf = (field: Locator) =>
  field.evaluate((el) => el.scrollHeight)

const lineHeightOf = (field: Locator) =>
  field.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).lineHeight),
  )

/** The value setter on the prototype plus a bubbling `input` event: an edit React sees. */
const editLikeAKeystroke = (field: Locator, value: string) =>
  field.evaluate((el, next) => {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
    Reflect.set(proto, "value", next, el)
    el.dispatchEvent(new Event("input", { bubbles: true }))
  }, value)

const activeLabel = (page: Page) =>
  page.evaluate(
    () => document.activeElement?.getAttribute("aria-label") ?? null,
  )

const LOREM = "lorem ipsum dolor sit amet consectetur "
const fiveThousand = LOREM.repeat(Math.ceil(5000 / LOREM.length)).slice(
  0,
  5000,
)

test.describe("TextArea autoResize under hostile content", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/fields")
    await awaitClientHandover(page)
    await textbox(page, "Uncapped text area").waitFor()
  })

  test("5 000 characters: the capped field stops at maxRows and scrolls, the uncapped one grows to fit or holds its 100-row cap", async ({
    page,
  }) => {
    const capped = textbox(page, "Auto-resizing text area")
    const uncapped = textbox(page, "Uncapped text area")
    const cappedEmpty = await settledHeight(capped)
    const uncappedEmpty = await settledHeight(uncapped)
    const lineHeight = await lineHeightOf(capped)
    expect(lineHeight, "line-height resolves to px").toBeGreaterThan(0)
    expect(
      Math.abs(cappedEmpty - 2 * lineHeight),
      `empty = the rows floor (2 × ${lineHeight}), read ${cappedEmpty}`,
    ).toBeLessThanOrEqual(1.5)

    await capped.fill(fiveThousand)
    await expect(capped, "the fill landed").toHaveValue(fiveThousand)
    const cappedFull = await settledHeight(capped)
    const cappedScroll = await scrollHeightOf(capped)
    test.info().annotations.push({
      type: "capped-5000",
      description: `empty ${cappedEmpty}px → ${cappedFull}px, scrollHeight ${cappedScroll}px, line ${lineHeight}px`,
    })
    expect(cappedFull, "it grew").toBeGreaterThan(cappedEmpty)
    expect(
      Math.abs(cappedFull - 5 * lineHeight),
      "and stopped at exactly maxRows (5) rows",
    ).toBeLessThanOrEqual(1.5)
    expect(
      cappedScroll - cappedFull,
      "the rest scrolls inside the box",
    ).toBeGreaterThan(lineHeight)
    await expect(capped, "at the cap the inner field scrolls").toHaveCSS(
      "overflow-y",
      "auto",
    )

    await uncapped.fill(fiveThousand)
    await expect(uncapped).toHaveValue(fiveThousand)
    const uncappedFull = await settledHeight(uncapped)
    const uncappedScroll = await scrollHeightOf(uncapped)
    const rows = Math.round(uncappedFull / lineHeight)
    test.info().annotations.push({
      type: "uncapped-5000",
      description: `empty ${uncappedEmpty}px → ${uncappedFull}px (${rows} rows), scrollHeight ${uncappedScroll}px`,
    })
    expect(uncappedFull).toBeGreaterThan(uncappedEmpty)
    if (uncappedScroll > uncappedFull + 1) {
      //more than 100 rows of content on this viewport: the default cap holds
      expect(
        Math.abs(uncappedFull - 100 * lineHeight),
        "past 100 rows the default maxRows cap holds",
      ).toBeLessThanOrEqual(1.5)
    } else {
      expect(
        Math.abs(uncappedFull - uncappedScroll),
        "under the cap the box fits its content — no inner scroll",
      ).toBeLessThanOrEqual(1)
      expect(rows).toBeLessThanOrEqual(100)
    }

    await capped.fill("")
    await uncapped.fill("")
    expect(
      await settledHeight(capped),
      "cleared, the capped field is back at its floor",
    ).toBe(cappedEmpty)
    expect(
      await settledHeight(uncapped),
      "cleared, the uncapped field is back at its floor",
    ).toBe(uncappedEmpty)
  })

  test("200 newlines: the uncapped field caps at 100 rows and the content scrolls; clearing restores the floor", async ({
    page,
  }) => {
    const uncapped = textbox(page, "Uncapped text area")
    const empty = await settledHeight(uncapped)
    const lineHeight = await lineHeightOf(uncapped)
    const newlines = "\n".repeat(200)

    await uncapped.fill(newlines)
    await expect(uncapped).toHaveValue(newlines)
    const full = await settledHeight(uncapped)
    const scroll = await scrollHeightOf(uncapped)
    test.info().annotations.push({
      type: "newlines-200",
      description: `empty ${empty}px → ${full}px, scrollHeight ${scroll}px, line ${lineHeight}px`,
    })
    expect(
      Math.abs(full - 100 * lineHeight),
      "201 lines is past the default cap of 100 rows",
    ).toBeLessThanOrEqual(1.5)
    expect(
      scroll,
      "all 201 lines are there to scroll",
    ).toBeGreaterThanOrEqual(200 * lineHeight)
    //the at-cap state is an inline lock on the inner field; the computed `overflow-y`
    //cannot tell (a textarea's UA default is already `auto`)
    const inlineOverflowY = () =>
      uncapped.evaluate((el) => (el as HTMLElement).style.overflowY)
    await expect
      .poll(inlineOverflowY, {
        message: "at the cap the field carries the overflow lock",
      })
      .toBe("auto")

    await uncapped.fill("")
    await expect(uncapped).toHaveValue("")
    expect(await settledHeight(uncapped), "back at the floor").toBe(empty)
    await expect
      .poll(inlineOverflowY, {
        message: "under the cap again the overflow lock is gone",
      })
      .toBe("")
  })

  for (const sample of [
    {
      name: "RTL Arabic",
      dir: "rtl",
      text: "مرحبا بالعالم\nهذا نص عربي\nسطر ثالث",
    },
    {
      name: "CJK",
      dir: null,
      text: "こんにちは世界\n中文测试文本\n한국어 텍스트",
    },
    { name: "emoji", dir: null, text: "🎉🎉🎉🎉\n👨‍👩‍👧‍👦🏳️‍🌈\n🇵🇹 🇯🇵 🇧🇷" },
  ]) {
    test(`${sample.name}: three lines measure three rows and the box empties back to its floor`, async ({
      page,
    }) => {
      const capped = textbox(page, "Auto-resizing text area")
      const empty = await settledHeight(capped)
      const lineHeight = await lineHeightOf(capped)
      if (sample.dir) {
        await capped.evaluate(
          (el, dir) => el.setAttribute("dir", dir),
          sample.dir,
        )
        expect(
          await capped.evaluate((el) => getComputedStyle(el).direction),
          "the direction actually flipped",
        ).toBe(sample.dir)
      }
      await capped.fill(sample.text)
      await expect(capped).toHaveValue(sample.text)
      const full = await settledHeight(capped)
      const scroll = await scrollHeightOf(capped)
      test.info().annotations.push({
        type: sample.name,
        description: `empty ${empty}px → ${full}px, scrollHeight ${scroll}px, line ${lineHeight}px`,
      })
      expect(full).toBeGreaterThan(empty)
      expect(
        Math.abs(full - 3 * lineHeight),
        "three lines of any script are three rows: line-height is a number, so the glyphs do not move the line box",
      ).toBeLessThanOrEqual(1.5)
      expect(
        Math.abs(scroll - full),
        "under the cap nothing scrolls",
      ).toBeLessThanOrEqual(1)

      await capped.fill("")
      expect(await settledHeight(capped)).toBe(empty)
      if (sample.dir) {
        await capped.evaluate((el) => el.removeAttribute("dir"))
      }
    })
  }

  test("a 200% root font re-measures: the height doubles with the line and matches a fresh fill at the new size", async ({
    page,
  }) => {
    const capped = textbox(page, "Auto-resizing text area")
    const text = "one\ntwo\nthree"
    //every step leaves its numbers in the report: the inline height the sync
    //wrote (rem), what the browser made of it, and the content behind it
    const snapshot = async (step: string) => {
      const s = await capped.evaluate((el) => {
        const cs = getComputedStyle(el)
        return {
          styleHeight: (el as HTMLElement).style.height,
          client: el.clientHeight,
          scroll: el.scrollHeight,
          width: el.clientWidth,
          line: cs.lineHeight,
          font: cs.fontSize,
          root: getComputedStyle(document.documentElement).fontSize,
          value: (el as HTMLTextAreaElement).value.length,
          cap:
            (el as HTMLElement).style.overflowY === "auto"
              ? "at-cap"
              : "under-cap",
        }
      })
      test.info().annotations.push({
        type: `font-200-${step}`,
        description: JSON.stringify(s),
      })
    }
    await capped.fill(text)
    await expect(capped).toHaveValue(text)
    const at100 = await settledHeight(capped)
    const line100 = await lineHeightOf(capped)
    await snapshot("filled-at-100")
    expect(Math.abs(at100 - 3 * line100)).toBeLessThanOrEqual(1.5)

    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%"
    })
    const line200 = await lineHeightOf(capped)
    expect(
      Math.abs(line200 - 2 * line100),
      "premise: the field's line-height follows the root font",
    ).toBeLessThanOrEqual(1)
    const at200 = await settledHeight(capped)
    await snapshot("after-font-200")
    test.info().annotations.push({
      type: "font-200",
      description: `100%: ${at100}px (line ${line100}) → 200%: ${at200}px (line ${line200})`,
    })
    expect(at200, "the height grew with the font").toBeGreaterThan(at100)
    expect(
      Math.abs(at200 - 3 * line200),
      "and is three rows of the new line",
    ).toBeLessThanOrEqual(2)

    //a fresh measurement at 200% must land on the same height: a stale cap or
    //a stale line-height would show here as a difference
    await capped.fill("")
    await settledHeight(capped)
    await snapshot("cleared-at-200")
    await capped.fill(text)
    const fresh = await settledHeight(capped)
    await snapshot("refilled-at-200")
    expect(
      Math.abs(fresh - at200),
      `a fresh fill at 200% measures the same (${fresh} vs ${at200})`,
    ).toBeLessThanOrEqual(1)

    await page.evaluate(() => {
      document.documentElement.style.fontSize = ""
    })
    await settledHeight(capped)
    await snapshot("after-font-reset")
    await capped.fill("")
    const floorAgain = await settledHeight(capped)
    await snapshot("cleared-at-100")
    expect(
      Math.abs(floorAgain - 2 * line100),
      `back at 100% and empty, the floor is two rows again (${floorAgain} vs ${2 * line100})`,
    ).toBeLessThanOrEqual(1.5)
  })

  test("an empty field sits at its rows floor even when the placeholder wraps past it, and a fill after that measures the text", async ({
    page,
    browserName,
  }) => {
    const capped = textbox(page, "Auto-resizing text area")
    const line = await lineHeightOf(capped)
    const floor = await settledHeight(capped)
    expect(
      Math.abs(floor - 2 * line),
      "premise: empty, the field is two rows",
    ).toBeLessThanOrEqual(1)

    //a placeholder that wraps well past two rows at any width
    await capped.evaluate((el) => {
      ;(el as HTMLTextAreaElement).placeholder = "wrap ".repeat(200).trim()
    })
    //what the engine reads for the empty field with no inline height: WebKit
    //folds the placeholder in, which is the input the fix answers
    const unconstrained = await capped.evaluate((el) => {
      const node = el as HTMLTextAreaElement
      const inline = node.style.height
      node.style.height = "auto"
      const read = node.scrollHeight
      node.style.height = inline
      return read
    })
    test.info().annotations.push({
      type: "placeholder-scroll-height",
      description: `empty field with a wrapping placeholder: scrollHeight ${unconstrained}px at height:auto, floor ${floor}px (${browserName})`,
    })
    if (browserName === "webkit") {
      expect(
        unconstrained,
        "premise: WebKit measures the placeholder into an empty field",
      ).toBeGreaterThan(floor)
    }

    //a sync with the empty value: the floor, whatever the placeholder measures
    await capped.fill("x")
    await capped.fill("")
    expect(
      await settledHeight(capped),
      "the floor, not the placeholder",
    ).toBe(floor)
    //and a fill after the clear measures the text, not what the box was
    await capped.fill("one\ntwo\nthree")
    expect(
      Math.abs((await settledHeight(capped)) - 3 * line),
      "three rows of text",
    ).toBeLessThanOrEqual(1.5)
    await capped.fill("")
    expect(await settledHeight(capped)).toBe(floor)
  })

  test("a zero-width box: no exception, no ResizeObserver loop, the cap holds and the page keeps working", async ({
    page,
  }) => {
    const errors: string[] = []
    const loops: string[] = []
    const consoleErrors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.on("console", (message) => {
      if (/ResizeObserver loop/i.test(message.text()))
        loops.push(message.text())
      if (message.type() === "error") consoleErrors.push(message.text())
    })

    const zero = textbox(page, "Zero-width text area")
    const box = page.getByTestId("zero-width-box")
    expect(
      await box.evaluate((el) => el.getBoundingClientRect().width),
      "premise: the box really is zero wide",
    ).toBe(0)
    const lineHeight = await lineHeightOf(zero)
    const empty = await settledHeight(zero)

    const text = "a".repeat(2000)
    await editLikeAKeystroke(zero, text)
    await expect(zero).toHaveValue(text)
    const full = await settledHeight(zero)
    const scroll = await scrollHeightOf(zero)
    test.info().annotations.push({
      type: "zero-width",
      description: `empty ${empty}px → ${full}px, scrollHeight ${scroll}px, line ${lineHeight}px, console errors ${consoleErrors.length}`,
    })
    expect(Number.isFinite(full)).toBe(true)
    expect(
      Math.abs(full - 5 * lineHeight),
      "every character on its own line is thousands of rows: the cap holds",
    ).toBeLessThanOrEqual(1.5)

    await editLikeAKeystroke(zero, "")
    await expect(zero).toHaveValue("")
    expect(await settledHeight(zero), "and it empties back").toBe(empty)

    //the rest of the page is untouched by the hostile box
    const capped = textbox(page, "Auto-resizing text area")
    await capped.fill("still works")
    await expect(capped).toHaveValue("still works")

    expect(errors, "no uncaught exception").toEqual([])
    expect(loops, "no ResizeObserver loop error").toEqual([])
  })

  test("100 keystrokes at zero delay land on the same height as a fresh fill of the same text", async ({
    page,
  }) => {
    const uncapped = textbox(page, "Uncapped text area")
    const empty = await settledHeight(uncapped)
    //16 lines in 100 keystrokes; the uncapped probe has no onSubmitKey, so Enter
    //is a newline here
    const text = "abcde\n".repeat(16).concat("fghi")
    expect(text.length, "premise: exactly 100 keystrokes").toBe(100)

    await uncapped.click()
    expect(await activeLabel(page)).toBe("Uncapped text area")
    await page.keyboard.type(text, { delay: 0 })
    await expect(uncapped, "every keystroke landed").toHaveValue(text)
    const typed = await settledHeight(uncapped)

    await uncapped.fill("")
    expect(await settledHeight(uncapped)).toBe(empty)
    await uncapped.fill(text)
    await expect(uncapped).toHaveValue(text)
    const fresh = await settledHeight(uncapped)
    test.info().annotations.push({
      type: "rapid-typing",
      description: `typed ${typed}px, fresh fill ${fresh}px, empty ${empty}px`,
    })
    expect(
      Math.abs(typed - fresh),
      "no stale measurement after rapid typing",
    ).toBeLessThanOrEqual(1)
    expect(typed).toBeGreaterThan(empty)
    expect(await activeLabel(page), "focus never left the field").toBe(
      "Uncapped text area",
    )

    await uncapped.fill("")
    expect(await settledHeight(uncapped), "cleared to empty = floor").toBe(
      empty,
    )
  })
})

test.describe("controlled fields whose owner applies the value late", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/fields")
    await awaitClientHandover(page)
    await textbox(page, "Lagging controlled field").waitFor()
  })

  test("a synchronous owner: a mid-text insert keeps the caret after the inserted character", async ({
    page,
  }) => {
    const field = textbox(page, "Sync controlled field")
    await field.click()
    await page.keyboard.type("hello", { delay: 10 })
    await expect(field).toHaveValue("hello")
    await field.evaluate((el) =>
      (el as HTMLInputElement).setSelectionRange(2, 2),
    )
    await page.keyboard.type("X")
    await expect(field).toHaveValue("heXllo")
    expect(
      await field.evaluate(
        (el) => (el as HTMLInputElement).selectionStart,
      ),
      "the caret sits right after the X, not at the end",
    ).toBe(3)
    expect(await activeLabel(page)).toBe("Sync controlled field")
  })

  test("a 50ms-late owner: keystrokes slower than the lag all land, and the value the page holds is what was typed", async ({
    page,
  }) => {
    const field = textbox(page, "Lagging controlled field")
    await field.click()
    await page.keyboard.type("hello", { delay: 90 })
    await expect(field, "every keystroke landed").toHaveValue("hello")
    await expect(page.getByTestId("lagging-value")).toHaveText("hello")

    await field.evaluate((el) =>
      (el as HTMLInputElement).setSelectionRange(2, 2),
    )
    await page.keyboard.type("X")
    await expect(field).toHaveValue("heXllo")
    await expect(page.getByTestId("lagging-value")).toHaveText("heXllo")
    //React restores the prop value after the input event and moves the caret
    //when it does; where it lands is React's contract, not the primitive's, so
    //it is recorded and not asserted
    const caret = await field.evaluate(
      (el) => (el as HTMLInputElement).selectionStart,
    )
    test.info().annotations.push({
      type: "lagging-caret",
      description: `after a mid-text insert under a 50ms-late owner the caret sits at ${caret} (3 = kept, 6 = jumped to the end)`,
    })
    expect(await activeLabel(page)).toBe("Lagging controlled field")
  })

  test("a 50ms-late owner on the TextArea: the value lands and the height follows the value, not the keystroke", async ({
    page,
  }) => {
    const field = textbox(page, "Lagging text area")
    const empty = await settledHeight(field)
    const lineHeight = await lineHeightOf(field)
    await field.click()
    await page.keyboard.type("a\nb\nc", { delay: 90 })
    await expect(field).toHaveValue("a\nb\nc")
    const full = await settledHeight(field)
    test.info().annotations.push({
      type: "lagging-textarea",
      description: `empty ${empty}px → ${full}px, line ${lineHeight}px`,
    })
    expect(
      Math.abs(full - 3 * lineHeight),
      "three rows once the late value arrives",
    ).toBeLessThanOrEqual(1.5)
  })
})

test.describe("Input — the native attributes it forwards, and the submit key's edges", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/fields")
    await awaitClientHandover(page)
    await textbox(page, "Toggleable field").waitFor()
  })

  test("Enter with Ctrl or Meta still submits (the gate is Shift only); Shift+Enter never does", async ({
    page,
  }) => {
    const search = page.getByRole("searchbox", { name: "Search field" })
    await search.click()
    await page.keyboard.type("q")
    await search.press("Shift+Enter")
    await search.press("Control+Enter")
    await expect
      .poll(() => countLog(page, /onSubmitKey\("q"\)/), {
        message: "Ctrl+Enter is an Enter without Shift",
      })
      .toBe(1)
    await search.press("Meta+Enter")
    await expect.poll(() => countLog(page, /onSubmitKey\("q"\)/)).toBe(2)
    await search.press("Alt+Enter")
    await expect.poll(() => countLog(page, /onSubmitKey\("q"\)/)).toBe(3)
    expect(
      await countLog(page, /onSubmitKey/),
      "Shift+Enter fired nothing",
    ).toBe(3)
  })

  test("disabled under the caret: focus leaves, the value survives, Enter submits nothing, and re-enabling hands the field back", async ({
    page,
    browserName,
  }) => {
    const field = textbox(page, "Toggleable field")
    const toggle = page.getByTestId("toggle-live-disabled")
    await field.click()
    await page.keyboard.type("abc")
    await expect(field).toHaveValue("abc")
    expect(await activeLabel(page)).toBe("Toggleable field")

    //a script click, so the button never takes focus itself: the only thing
    //that can move focus is the field becoming disabled
    await toggle.evaluate((el) => (el as HTMLButtonElement).click())
    await expect(field).toBeDisabled()
    await expect(field, "the value survives").toHaveValue("abc")
    const focusAfterDisable = await activeLabel(page)
    test.info().annotations.push({
      type: "focus-after-disable",
      description: `${browserName}: activeElement aria-label = ${focusAfterDisable}`,
    })

    await page.keyboard.press("Enter")
    await page.keyboard.type("zzz")
    await expect(field, "a disabled field takes no keystroke").toHaveValue(
      "abc",
    )
    expect(
      await countLog(page, /toggleable onSubmitKey/),
      "Enter on a disabled field submits nothing",
    ).toBe(0)

    await toggle.evaluate((el) => (el as HTMLButtonElement).click())
    await expect(field).toBeEnabled()
    await expect(field).toHaveValue("abc")
    await field.focus()
    await page.keyboard.type("d")
    await expect(field).toHaveValue("abcd")
    await page.keyboard.press("Enter")
    await expect
      .poll(() => countLog(page, /toggleable onSubmitKey/))
      .toBe(1)
  })

  test("readOnly: keystrokes change nothing; what Enter does is recorded", async ({
    page,
  }) => {
    const field = textbox(page, "Read-only field")
    await expect(field).toHaveAttribute("readonly", "")
    await field.click()
    await page.keyboard.type("zzz")
    await expect(field).toHaveValue("read only")
    await page.keyboard.press("Enter")
    await page.waitForTimeout(100)
    const fired = await countLog(page, /read-only onSubmitKey/)
    test.info().annotations.push({
      type: "readonly-enter",
      description: `Enter on a readOnly field fired onSubmitKey ${fired} time(s)`,
    })
    await expect(field).toHaveValue("read only")
  })

  test("maxLength: typed input stops at the limit; a programmatic fill is recorded", async ({
    page,
  }) => {
    const field = textbox(page, "Max length field")
    await field.click()
    await page.keyboard.type("abcdefghijklmnopqrst")
    await expect(field).toHaveValue("abcdefghij")
    await field.fill("")
    await field.fill("12345678901234567890")
    const filled = await field.inputValue()
    test.info().annotations.push({
      type: "maxlength-fill",
      description: `fill() of 20 chars into maxLength=10 left ${filled.length} chars (the DOM setter does not enforce maxLength; only typing does)`,
    })
    await field.fill("")
    await page.keyboard.type("xyz")
    await expect(field, "typing still works after the fill").toHaveValue(
      "xyz",
    )
  })

  test("type=number: hostile input never throws and the field recovers", async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))
    const field = page.getByRole("spinbutton", { name: "Number field" })
    await field.click()
    await page.keyboard.type("12ab-3.4e5..--e")
    const value = await field.inputValue()
    test.info().annotations.push({
      type: "number-hostile",
      description: `typed "12ab-3.4e5..--e" → value "${value}"`,
    })
    //the sanitization algorithm: a valid floating-point number or the empty string
    expect(value).toMatch(/^(-?\d*\.?\d*(e[-+]?\d+)?)?$/i)
    await field.fill("42")
    await expect(field).toHaveValue("42")
    expect(
      await field.evaluate((el) => (el as HTMLInputElement).valueAsNumber),
    ).toBe(42)
    expect(errors).toEqual([])
  })
})

test.describe("autofocus under the keyboard mock", () => {
  test.beforeEach(async ({ page }) => {
    //the hook only enters mock mode if the mock exists when its effect mounts
    await page.addInitScript(() => {
      ;(
        window as unknown as {
          __adaptvKeyboardMock: { isOpen: boolean; height: number }
        }
      ).__adaptvKeyboardMock = { isOpen: false, height: 0 }
    })
    await page.goto("/lab/fields")
    await awaitClientHandover(page)
    await page.getByTestId("mount-autofocus").waitFor()
  })

  const setKeyboard = (page: Page, isOpen: boolean, height: number) =>
    page.evaluate(
      ({ isOpen, height }) => {
        ;(
          window as unknown as {
            __adaptvKeyboardMock: { isOpen: boolean; height: number }
          }
        ).__adaptvKeyboardMock = { isOpen, height }
        window.dispatchEvent(new Event("adaptv:keyboard-mock"))
      },
      { isOpen, height },
    )

  test("a field mounted with autoFocus keeps focus while the keyboard opens and closes, and the page's readout follows", async ({
    page,
  }) => {
    await page.getByTestId("mount-autofocus").click()
    const field = textbox(page, "Autofocus field")
    await expect(field).toBeVisible()
    await expect
      .poll(() => activeLabel(page), { message: "autoFocus took" })
      .toBe("Autofocus field")

    await setKeyboard(page, true, 336)
    await expect(page.locator("html")).toHaveAttribute(
      "data-keyboard-open",
      "",
    )
    await expect(page.getByText("336px", { exact: true })).toBeVisible()
    expect(
      await activeLabel(page),
      "the keyboard opening did not move focus",
    ).toBe("Autofocus field")
    await page.keyboard.type("typed under the keyboard")
    await expect(field).toHaveValue("typed under the keyboard")

    await setKeyboard(page, false, 0)
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-keyboard-open",
      "",
    )
    await expect(page.getByText("0px", { exact: true })).toBeVisible()
    expect(await activeLabel(page), "nor did it closing").toBe(
      "Autofocus field",
    )
    await expect(field).toHaveValue("typed under the keyboard")
  })
})
