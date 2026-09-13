import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"

/*
 * Checkbox & Switch — a hidden native input for semantics under a painted box,
 * toggled by a pointer gesture engine (the same one swipeable uses).
 *
 * This file pins the parts that are DETERMINISTIC headless: indeterminate
 * resolving to checked, the uncontrolled default, disabled inertness, and Space
 * toggling exactly once. The onCheckedChange CONTRACT under a controlled/frozen
 * owner, the pointer tap, and the Switch DRAG are left to a real-finger sim walk —
 * the gesture engine does not respond to synthetic pointer / mouse / CDP-touch
 * events reliably in headless Playwright (they perform only the native DOM toggle),
 * so a "controlled tap" test here would be pinning an artefact, not the contract.
 *
 * chromium is enough — semantics, not engine-specific rendering.
 *
 * ⚠︎ One exception, and it is geometry: the Switch's accessible element. Its
 * `<input role="switch">` is what VoiceOver, TalkBack and automation treat as
 * the control, so its box must BE the track. It was an sr-only 1x1 box one pixel
 * left of a 48x28 track, and a click at its centre hit nothing (the iOS sim QA
 * finding). Layout is real only in a browser and differs by engine, so those
 * tests measure on chromium AND webkit. With the input over the track, a plain
 * click at its centre does drive the engine on both, so that tap is pinned here
 * after all, and exactly once.
 */

const LOG = "[data-lab-log] li"
const logJoin = (page: Page) =>
  page
    .locator(LOG)
    .allInnerTexts()
    .then((t) => t.join("\n"))

const input = (page: Page, role: "checkbox" | "switch", name: string) =>
  page.getByRole(role, { name, exact: true })

/**
 * Wait for the client to take over before pressing anything.
 *
 * The inputs are server-rendered, so the `waitFor()` below is satisfied by
 * inert HTML. A Space press in that window still toggles the native input —
 * the UA does that on its own — but React is not listening yet, so
 * `onCheckedChange` never fires and the lab log stays empty: the test reads
 * "toggled zero times" while the checkbox visibly moved. That is the worst
 * shape of this bug, because the page looks like it worked. It is not load
 * flake: Playwright boots its own dev server and tears it down per run, so
 * the FIRST test to reach this route pays the cold transform cost and loses
 * the race while every test after it wins. A dev session left running hides
 * it, because `reuseExistingServer` then hands the suite a warm server.
 *
 * The splash is server-rendered too and self-unmounts only once the client
 * has hydrated and the local store has seeded, so its disappearance is the
 * one honest "React is driving now" signal on the page. Given a generous
 * timeout on purpose — a cold route's first transform can outrun the 5s
 * default, and a tight timeout here would re-create the flake it removes.
 */
async function awaitClientHandover(page: Page) {
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
}

test.describe("Checkbox & Switch semantics", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/toggles")
    await awaitClientHandover(page)
    await input(page, "checkbox", "Controlled checkbox").waitFor()
  })

  test("the indeterminate checkbox starts mixed and resolves its first toggle to CHECKED", async ({
    page,
  }) => {
    const ind = input(page, "checkbox", "Indeterminate checkbox")
    await expect(ind, "starts mixed").toBeChecked({ indeterminate: true })
    await ind.focus()
    await page.keyboard.press("Space")
    // the ASK is the point: the first activation must resolve to TRUE. (The visual
    // stays off — this lab holds checked={false} and only clears indeterminate — so
    // the value reported is what matters, not the owner's kept state.)
    await expect
      .poll(() => logJoin(page), {
        message:
          "resolving to unchecked would silently lose the user's intent",
      })
      .toMatch(/resolved to true/)
    expect(await logJoin(page), "must not resolve to false").not.toMatch(
      /resolved to false/,
    )
  })

  test("Space toggles a focused control exactly once per press", async ({
    page,
  }) => {
    const sw = input(page, "switch", "Lab switch")
    await expect(sw).not.toBeChecked()
    await sw.focus()
    await page.keyboard.press("Space")
    await expect(sw, "one Space press toggles once").toBeChecked()
    await page.keyboard.press("Space")
    await expect(sw, "…and again, exactly once").not.toBeChecked()
  })

  test("an uncontrolled checkbox owns its own state", async ({ page }) => {
    const un = input(page, "checkbox", "Uncontrolled checkbox")
    await expect(un, "defaultChecked").toBeChecked()
    await un.focus()
    await page.keyboard.press("Space")
    await expect(un, "it flips itself with no owner").not.toBeChecked()
  })

  test("a checkbox exposes a proper accessible role and name", async ({
    page,
  }) => {
    // the whole point of the hidden native input: real semantics for AT + tests
    await expect(
      input(page, "checkbox", "Controlled checkbox"),
    ).toHaveAttribute("type", "checkbox")
    await expect(input(page, "switch", "Lab switch")).toHaveAttribute(
      "role",
      "switch",
    )
  })

  //A toggle's `<input>` is what VoiceOver, TalkBack and automation treat as the
  //control, so its box must BE the element the finger toggles. Both were an
  //sr-only 1x1 box: the switch's sat one pixel left of its track, so a click at
  //its centre hit nothing (the iOS sim QA finding), and the checkbox's sat in
  //the middle of its label, under the painted box. Layout is real only in a browser and differs by
  //engine, so these run on chromium AND webkit.
  for (const control of [
    {
      role: "switch",
      name: "Lab switch",
      host: "switch",
      part: "track",
      toggled: /switch → /g,
    },
    {
      role: "checkbox",
      name: "Controlled checkbox",
      host: "checkbox",
      part: "label",
      toggled: /onCheckedChange\(/g,
    },
  ] as const) {
    test(`the ${control.role}'s accessible element IS its ${control.part}, not a 1px speck`, async ({
      page,
    }) => {
      const el = input(page, control.role, control.name)
      const host = page
        .locator(`[data-adaptv='${control.host}']`)
        .filter({ has: el })
      await el.scrollIntoViewIfNeeded()
      const box = await el.boundingBox()
      const hostBox = await host.boundingBox()
      if (!box || !hostBox)
        throw new Error(`the ${control.role} has no box`)
      //what VoiceOver, TalkBack and every automation tool read as the
      //control's frame, and where they aim a tap: the area the finger toggles
      expect(
        box.width,
        `as wide as the ${control.part}`,
      ).toBeGreaterThanOrEqual(hostBox.width - 0.5)
      expect(
        box.height,
        `as tall as the ${control.part}`,
      ).toBeGreaterThanOrEqual(hostBox.height - 0.5)
      expect(Math.abs(box.x - hostBox.x)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(box.y - hostBox.y)).toBeLessThanOrEqual(0.5)
      //covering it must not paint a native control over the painted one
      await expect(el).toHaveCSS("opacity", "0")
      //the element under the frame's centre is the control itself, so a tap
      //aimed there reaches it rather than the painted part or a neighbour
      const hit = await page.evaluate(
        ({ x, y }) => {
          const target = document.elementFromPoint(x, y)
          return (
            target?.getAttribute("role") ??
            target?.getAttribute("type") ??
            target?.tagName ??
            null
          )
        },
        { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      )
      expect(hit).toBe(control.role)
    })

    test(`a click at the ${control.role}'s accessible centre toggles it exactly once`, async ({
      page,
    }) => {
      const el = input(page, control.role, control.name)
      await expect(el).not.toBeChecked()
      //Playwright aims at the centre of the ROLE element and refuses if
      //something else is hit there, the same aim an assistive tap takes
      await el.click({ timeout: 5_000 })
      await expect(el, "one click toggles once").toBeChecked()
      await page.waitForTimeout(150)
      const log = await logJoin(page)
      expect(
        log.match(control.toggled) ?? [],
        "exactly one toggle",
      ).toHaveLength(1)
    })

    test(`a programmatic click on the ${control.role} never toggles twice, and the DOM agrees with the state`, async ({
      page,
    }) => {
      //what VoiceOver and TalkBack dispatch on activation: a click on the
      //element with no press before it. Whether that click toggles at all is
      //the gesture engine's call; what the input covering the control must
      //never do is add a second toggle, or leave the DOM and the state apart
      const el = input(page, control.role, control.name)
      await expect(el).not.toBeChecked()
      await el.evaluate((node) => (node as HTMLInputElement).click())
      await page.waitForTimeout(150)
      const toggles = ((await logJoin(page)).match(control.toggled) ?? [])
        .length
      expect(toggles, "at most one toggle").toBeLessThanOrEqual(1)
      const state = await el.evaluate((node) => ({
        checked: (node as HTMLInputElement).checked,
        aria: node.getAttribute("aria-checked"),
      }))
      expect(state.checked, "DOM checked matches the state").toBe(
        toggles === 1,
      )
      if (control.role === "switch") {
        expect(state.aria).toBe(String(toggles === 1))
      }
    })
  }

  test("neither toggle is exposed as read-only in the accessibility tree", async ({
    page,
    browserName,
  }) => {
    //both inputs carry `readOnly` to tell React a controlled `checked` has no
    //`onChange` on purpose. It must not reach assistive tech as "read-only".
    //Only Chromium hands its accessibility tree to a test (CDP); WebKit's is
    //read on the simulator with VoiceOver
    test.skip(browserName !== "chromium", "CDP accessibility tree")
    const cdp = await page.context().newCDPSession(page)
    const { nodes } = await cdp.send("Accessibility.getFullAXTree")
    const seen: string[] = []
    for (const node of nodes) {
      const name = node.name?.value
      if (name !== "Lab switch" && name !== "Controlled checkbox") continue
      seen.push(`${node.role?.value}:${name}`)
      const props = Object.fromEntries(
        (node.properties ?? []).map((p) => [p.name, p.value.value]),
      )
      expect(props.readonly, `${name} is not read-only`).toBeUndefined()
      expect(props.focusable, `${name} is focusable`).toBe(true)
    }
    expect(seen.sort()).toEqual([
      "checkbox:Controlled checkbox",
      "switch:Lab switch",
    ])
  })

  test("disabled controls are inert — cannot be activated, and never fire", async ({
    page,
  }) => {
    const cb = input(page, "checkbox", "Disabled checkbox")
    const sw = input(page, "switch", "Disabled switch")
    await expect(cb).toBeDisabled()
    await expect(sw).toBeDisabled()
    // force a click past actionability; a disabled control must swallow it
    await cb.click({ force: true })
    await sw.click({ force: true })
    await page.waitForTimeout(150)
    expect(
      await logJoin(page),
      "a disabled control must never fire onCheckedChange",
    ).not.toMatch(/THIS MUST NEVER APPEAR/)
  })
})
