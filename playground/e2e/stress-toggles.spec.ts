import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Checkbox & Switch under stress — fifty rapid keyboard toggles, Space while
 * disabled, a disabled flag flipped mid-press, the click an outer label forwards,
 * indeterminate going round twice, reduced motion, and forced colours.
 *
 * Doctrine, same as `toggles.spec.ts`: the `onCheckedChange` contract is driven by
 * KEYBOARD (focus + Space) so the toggle is the engine's, the hydration gate in
 * every `beforeEach`, no retries, no sleeps where a condition can be awaited.
 * After every one of the fifty presses three facts are read in one evaluate and
 * must agree: the native `checked`, the `aria-checked` the Switch stamps, and the
 * parity the press count predicts. The Checkbox stamps no `aria-checked` (its
 * native `checked` IS the accessible state) and neither control stamps a
 * `data-checked` — both facts are asserted as they are, so a change shows.
 *
 * Both engines run the keyboard half; the accessibility-tree and forced-colours
 * reads are CDP / Chromium emulation and stay on chromium.
 */

const LOG = "[data-lab-log] li"
const logJoin = (page: Page) =>
  page
    .locator(LOG)
    .allInnerTexts()
    .then((t) => t.join("\n"))

const input = (page: Page, role: "checkbox" | "switch", name: string) =>
  page.getByRole(role, { name, exact: true })

const stateOf = (el: Locator) =>
  el.evaluate((node) => ({
    checked: (node as HTMLInputElement).checked,
    aria: node.getAttribute("aria-checked"),
    dataChecked:
      node.closest("label")?.getAttribute("data-checked") ?? null,
    focused: document.activeElement === node,
  }))

test.describe("Checkbox & Switch under stress", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/toggles")
    await awaitClientHandover(page)
    await input(page, "switch", "Disable-able switch").waitFor()
  })

  for (const control of [
    { role: "switch", name: "Lab switch", startsChecked: false },
    {
      role: "checkbox",
      name: "Controlled checkbox",
      startsChecked: false,
    },
    {
      role: "checkbox",
      name: "Uncontrolled checkbox",
      startsChecked: true,
    },
  ] as const) {
    test(`fifty rapid Space presses on the ${control.role} "${control.name}" land on the predicted parity, with checked and aria-checked agreeing after every one`, async ({
      page,
    }) => {
      const el = input(page, control.role, control.name)
      const before = await stateOf(el)
      expect(before.checked, "premise: the documented start state").toBe(
        control.startsChecked,
      )
      await el.focus()
      expect((await stateOf(el)).focused, "premise: focused").toBe(true)

      const disagreements: string[] = []
      for (let press = 1; press <= 50; press += 1) {
        await page.keyboard.press("Space")
        const expected =
          press % 2 === 1 ? !control.startsChecked : control.startsChecked
        const state = await stateOf(el)
        if (state.checked !== expected)
          disagreements.push(
            `press ${press}: checked ${state.checked}, expected ${expected}`,
          )
        if (control.role === "switch" && state.aria !== String(expected))
          disagreements.push(
            `press ${press}: aria-checked ${state.aria}, expected ${expected}`,
          )
        if (control.role === "checkbox" && state.aria !== null)
          disagreements.push(
            `press ${press}: a checkbox stamped aria-checked=${state.aria}`,
          )
        if (!state.focused)
          disagreements.push(`press ${press}: focus left the control`)
      }
      expect(disagreements, "every press agreed with itself").toEqual([])
      const after = await stateOf(el)
      expect(
        after.checked,
        "50 presses = even = back where it started",
      ).toBe(control.startsChecked)
      expect(
        after.dataChecked,
        "no data-checked is stamped (recorded)",
      ).toBe(null)
      expect(after.focused, "focus stayed on the control").toBe(true)
    })
  }

  test("Space on a disabled control activates nothing, whether the key reaches the input or the label", async ({
    page,
  }) => {
    const cb = input(page, "checkbox", "Disabled checkbox")
    const sw = input(page, "switch", "Disabled switch")
    await expect(cb).toBeDisabled()
    await expect(sw).toBeDisabled()
    //a disabled input cannot take focus; the key lands on the body
    await cb.focus().catch(() => undefined)
    await page.keyboard.press("Space")
    await sw.focus().catch(() => undefined)
    await page.keyboard.press("Space")
    //and a synthetic key pair straight at the engine on the label
    for (const el of [cb, sw]) {
      await el.evaluate((node) => {
        const label = node.closest("label") as HTMLElement
        for (const type of ["keydown", "keyup"]) {
          label.dispatchEvent(
            new KeyboardEvent(type, { key: " ", bubbles: true }),
          )
        }
      })
    }
    await page.waitForTimeout(150)
    await expect(cb, "still checked").toBeChecked()
    await expect(sw, "still off").not.toBeChecked()
    expect(await logJoin(page)).not.toMatch(/THIS MUST NEVER APPEAR/)
  })

  test("disabled flipped mid-press: Space held, disabled from a script, Space released — no activation; enabled again, a full press toggles", async ({
    page,
  }) => {
    const sw = input(page, "switch", "Disable-able switch")
    const toggle = page.getByTestId("toggle-switch-disabled")
    await expect(readout(page, "disableable")).toHaveText("off")
    await sw.focus()
    expect((await stateOf(sw)).focused).toBe(true)

    await page.keyboard.down("Space")
    //a script click, so the button never takes focus and the only change is
    //the flag flipping under a held key
    await toggle.evaluate((el) => (el as HTMLButtonElement).click())
    await expect(sw).toBeDisabled()
    await page.keyboard.up("Space")
    await page.waitForTimeout(150)
    await expect(
      readout(page, "disableable"),
      "the release activated nothing",
    ).toHaveText("off")
    await expect(sw).not.toBeChecked()
    expect(await logJoin(page)).not.toMatch(/disable-able → /)

    await toggle.evaluate((el) => (el as HTMLButtonElement).click())
    await expect(sw).toBeEnabled()
    await sw.focus()
    await page.keyboard.press("Space")
    await expect(
      readout(page, "disableable"),
      "a whole press after re-enabling toggles",
    ).toHaveText("on")
    const state = await stateOf(sw)
    expect(state.checked).toBe(true)
    expect(state.aria).toBe("true")
  })

  for (const probe of [
    {
      role: "switch" as const,
      name: "Lab switch",
      pattern: /switch → (true|false)/g,
      onValue: "true",
    },
    {
      role: "checkbox" as const,
      name: "Controlled checkbox",
      pattern: /onCheckedChange\((true|false)\)/g,
      onValue: "true",
    },
  ]) {
    test(`a script click on the ${probe.role}'s OWN label (no press on it): the reports are recorded, and the DOM agrees with the last one`, async ({
      page,
    }) => {
      const control = input(page, probe.role, probe.name)
      await expect(control).not.toBeChecked()
      //a script click on the label element itself. This is NOT the settings-row
      //idiom (an OUTER label forwarding to the input, which toggles once and is
      //pinned in switch.test.tsx / checkbox.test.tsx): the control's own label
      //is the engine's element, so the click reaches the engine unowned AND the
      //label then forwards a click to the input, unowned again, in the same
      //task — both read the same not-yet-committed state and report the same
      //value twice (measured 2026-09-21: two reports, both "on"). No press,
      //VoiceOver activation (a click on the input) or outer label produces this;
      //it is reachable by script only. The count is recorded so a change shows;
      //the claim is that the DOM, the aria state and the last report agree.
      await control.evaluate((node) =>
        (node.closest("label") as HTMLElement).click(),
      )
      await expect(control).toBeChecked()
      await page.waitForTimeout(150)
      const reports = [
        ...(await logJoin(page)).matchAll(probe.pattern),
      ].map((m) => m[1])
      const state = await stateOf(control)
      test.info().annotations.push({
        type: `${probe.role}-own-label-click`,
        description: `a script click on the ${probe.role}'s own label reported ${JSON.stringify(reports)}; DOM checked=${state.checked}`,
      })
      expect(
        reports.length,
        "the click reached the control",
      ).toBeGreaterThanOrEqual(1)
      expect(
        state.checked,
        "the DOM agrees with the last value reported",
      ).toBe(reports.at(-1) === probe.onValue)
      if (probe.role === "switch") {
        expect(state.aria, "aria-checked agrees with the DOM").toBe(
          String(state.checked),
        )
      }
    })
  }
  test("indeterminate resolves to checked, can be made mixed again, and resolves to checked again", async ({
    page,
  }) => {
    const ind = input(page, "checkbox", "Indeterminate checkbox")
    const mixed = () =>
      ind.evaluate((node) => (node as HTMLInputElement).indeterminate)
    await expect(ind).toBeChecked({ indeterminate: true })
    await ind.focus()
    await page.keyboard.press("Space")
    await expect.poll(() => logJoin(page)).toMatch(/resolved to true/)
    await expect.poll(mixed, { message: "no longer mixed" }).toBe(false)

    await page
      .getByRole("button", { name: "make it indeterminate again" })
      .click()
    await expect.poll(mixed, { message: "mixed again" }).toBe(true)
    await expect(ind).toBeChecked({ indeterminate: true })
    await ind.focus()
    await page.keyboard.press("Space")
    await expect
      .poll(
        async () =>
          ((await logJoin(page)).match(/resolved to true/g) ?? []).length,
      )
      .toBe(2)
    expect(await logJoin(page)).not.toMatch(/resolved to false/)
    await expect.poll(mixed).toBe(false)
  })
})

const readout = (page: Page, name: string) =>
  page.locator(`[data-readout="${name}"]`)

test.describe("Switch under prefers-reduced-motion", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.goto("/lab/toggles")
    await awaitClientHandover(page)
    await input(page, "switch", "Lab switch").waitFor()
  })

  test("the thumb's transform flips in the same frame as the state, with no transition on transform to wait out", async ({
    page,
  }) => {
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      "premise: the emulation took",
    ).toBe(true)
    const sw = input(page, "switch", "Lab switch")
    const thumb = sw.locator("xpath=..").locator("span[aria-hidden]")
    //`transition-property` alone cannot tell: its initial value is `all`. A
    //transition exists only with a duration, so the duration is what is read
    const read = () =>
      thumb.evaluate((el) => {
        const s = getComputedStyle(el)
        return {
          transform: s.transform,
          transition: `${s.transitionProperty} ${s.transitionDuration}`,
          duration: s.transitionDuration,
        }
      })
    const off = await read()
    await sw.focus()
    await page.keyboard.press("Space")
    await expect(sw).toBeChecked()
    //read at once, no wait: with no transition there is nothing to settle
    const on = await read()
    test.info().annotations.push({
      type: "reduced-motion-thumb",
      description: `off ${off.transform} → on ${on.transform}; transition-property "${on.transition}"`,
    })
    expect(on.transform, "the thumb moved").not.toBe(off.transform)
    expect(
      on.duration,
      "no transition with a duration that reduced motion would have to disable",
    ).toMatch(/^0s(, 0s)*$/)
  })
})

test.describe("Checkbox & Switch under forced colours", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "forced-colors emulation is Chromium's",
    )
    await page.emulateMedia({ forcedColors: "active" })
    await page.goto("/lab/toggles")
    await awaitClientHandover(page)
    await input(page, "switch", "Lab switch").waitFor()
  })

  test("what the painted box, track and thumb become is recorded (no forced-colors rule exists in the source)", async ({
    page,
  }) => {
    expect(
      await page.evaluate(
        () => matchMedia("(forced-colors: active)").matches,
      ),
      "premise: forced colours are active",
    ).toBe(true)
    const paint = (el: Locator) =>
      el.evaluate((node) => {
        const s = getComputedStyle(node)
        return {
          background: s.backgroundColor,
          border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
          outline: `${s.outlineWidth} ${s.outlineStyle}`,
          adjust: s.forcedColorAdjust,
          boxShadow: s.boxShadow === "none" ? "none" : "set",
        }
      })
    const cb = input(page, "checkbox", "Controlled checkbox")
    const box = cb.locator("xpath=..").locator(":scope > span").first()
    const sw = input(page, "switch", "Lab switch")
    const track = sw.locator("xpath=..")
    const thumb = track.locator("span[aria-hidden]")
    const report = {
      checkboxBox: await paint(box),
      switchTrack: await paint(track),
      switchThumb: await paint(thumb),
    }
    test.info().annotations.push({
      type: "forced-colors",
      description: JSON.stringify(report),
    })
    //the finding, stated as it is: nothing in src/ answers forced colours for
    //these two, so a visible edge here would be the consumer's ring, not the
    //primitive's. Recorded, not failed (see the report).
    expect(typeof report.switchThumb.background).toBe("string")
    //the controls still work under forced colours
    await sw.focus()
    await page.keyboard.press("Space")
    await expect(sw).toBeChecked()
  })
})
