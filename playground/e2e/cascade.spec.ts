import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The cascade contract (`docs/decisions/styling.md` §2, §5, §6), asserted in a real engine.
 *
 * Every claim in that doc is about RUNTIME PRECEDENCE, and none of it is visible
 * from the CSS text or from the unit suite: happy-dom compiles no Tailwind and
 * resolves no cascade, so `style-precedence.test.tsx` can only assert which class
 * string reached the DOM. Whether the resulting rule actually WINS is this file's
 * job, and something in this area regressed once already — the drawer's
 * reduced-motion rule was losing to its animation rule, hidden by an `!important`
 * that has since been removed.
 *
 * Runs in both projects on purpose. `chromium` is the Android/desktop engine;
 * `webkit` is the closest thing to iOS Safari without a device — it is desktop
 * WebKit, so a pass here is NOT proof for WKWebView, and device-only quirks still
 * have to be escalated to the iOS Simulator (see playwright.config.ts).
 *
 * ⚠︎ These probes inject class names into a live page, and Tailwind only emits what
 * it found by SCANNING SOURCE — a spec file is not scanned. The utilities used here
 * are present today only because adaptv's `@source` sweeps its own code (`src/` with
 * its tests in a checkout, the built `dist/` with its comments in the package), so
 * `active:scale-95` and `pb-safe-or-4` reach every consumer's CSS as a side effect. That is a wart, and if it is ever tightened these tests go red for a
 * reason that has nothing to do with the cascade — hence `expectCompiled`, which says
 * so out loud instead of failing as if the contract broke.
 */

/** Append a probe element and return its id. Removed by the page teardown. */
async function probe(
  page: Page,
  tag: string,
  attrs: Record<string, string>,
): Promise<string> {
  const id = `e2e-${Math.random().toString(36).slice(2, 8)}`
  await page.evaluate(
    ({ tag: t, attrs: a, id: i }) => {
      const el = document.createElement(t)
      el.id = i
      for (const [k, v] of Object.entries(a)) el.setAttribute(k, v)
      //pinned and on top so a real mouse press cannot land on something else
      el.setAttribute(
        "style",
        "position:fixed;inset:8px auto auto 8px;z-index:99999",
      )
      el.textContent = "probe"
      document.body.append(el)
    },
    { tag, attrs, id },
  )
  return id
}

/**
 * `user-select`, read the way BOTH engines will answer.
 *
 * WebKit reports only `-webkit-user-select` from `getComputedStyle` and returns an
 * empty string for the unprefixed name, so a naive read makes every selection
 * assertion fail on the one engine that matters most here. adaptv's CSS declares
 * both, so this is a probe problem, not a contract problem — the same shape as
 * `touch-action`, where Chrome canonicalises the longhand to `manipulation` and a
 * computed read cannot tell a correct rule from a broken one.
 */
function userSelect(page: Page, id: string): Promise<string> {
  return page.evaluate((i) => {
    const el = document.getElementById(i)
    if (!el) throw new Error(`probe ${i} vanished`)
    const cs = getComputedStyle(el)
    return (
      cs.getPropertyValue("-webkit-user-select").trim() ||
      cs.getPropertyValue("user-select").trim()
    )
  }, id)
}

/** One computed property of a probe, read in the page. */
function computed(page: Page, id: string, prop: string): Promise<string> {
  return page.evaluate(
    ({ id: i, prop: p }) => {
      const el = document.getElementById(i)
      if (!el) throw new Error(`probe ${i} vanished`)
      return getComputedStyle(el).getPropertyValue(p).trim()
    },
    { id, prop },
  )
}

/** The centre of a probe, for a real mouse press. */
async function centre(page: Page, id: string): Promise<[number, number]> {
  const box = await page.locator(`#${id}`).boundingBox()
  if (!box) throw new Error(`probe ${id} has no layout box`)
  return [box.x + box.width / 2, box.y + box.height / 2]
}

/**
 * Fail with the real diagnosis when a probe class was never generated, rather than
 * with a misleading "the cascade is wrong".
 */
async function expectCompiled(page: Page, className: string) {
  const found = await page.evaluate((cls) => {
    const needle = `.${CSS.escape(cls)}`
    const walk = (rules: CSSRuleList): boolean =>
      Array.from(rules).some((r) => {
        const sel = (r as CSSStyleRule).selectorText
        if (typeof sel === "string" && sel.includes(needle)) return true
        const nested = (r as CSSGroupingRule).cssRules
        return nested ? walk(nested) : false
      })
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        if (walk(sheet.cssRules)) return true
      } catch {
        //cross-origin sheet — nothing adaptv ships, skip
      }
    }
    return false
  }, className)

  expect(
    found,
    `\`${className}\` is not in the app's compiled CSS, so there is nothing to ` +
      `verify. That is a BUILD/scanning problem, not a cascade failure — the ` +
      `utility has to appear in scanned source for Tailwind to emit it.`,
  ).toBe(true)
}

test.describe("cascade layers", () => {
  test("an unlayered consumer rule beats an adaptv patch, with no !important", async ({
    page,
  }) => {
    // §6: unlayered styles beat every layer at any specificity. This is the whole
    // reason `patches.css` was allowed to drop its cascade-only `!important`s — if
    // it is false, every one of those resets becomes unoverridable and adaptv has
    // recreated the exact specificity war Ionic consumers complain about.
    await page.goto("/")
    await awaitClientHandover(page)
    const id = await probe(page, "div", {})
    await page.addStyleTag({
      content: `#${id} { user-select: text; scrollbar-width: thin; }`,
    })

    expect(await userSelect(page, id)).toBe("text")
    expect(await computed(page, id, "scrollbar-width")).toBe("thin")
  })

  test("media is unselectable regardless of the ui.noSelect knob", async ({
    page,
  }) => {
    // Deliberately NOT behind the stamp: a selection-drag starting on an image is
    // what begins a native image drag, which steals the pointer from the gesture
    // engine — swipe a row containing a thumbnail and it stops tracking the finger.
    await page.goto("/")
    await awaitClientHandover(page)
    const id = await probe(page, "img", {
      alt: "",
      src: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    })

    expect(await userSelect(page, id)).toBe("none")

    //turn the knob off entirely — media must not follow it
    await page.evaluate(() =>
      document.documentElement.removeAttribute("data-adaptv-no-select"),
    )
    expect(await userSelect(page, id)).toBe("none")
  })
})

test.describe("the active: patch", () => {
  /*
   * ⚠︎ `:active` is a UA state — `dispatchEvent(new MouseEvent("mousedown"))` does
   * NOT set it. These use a real press (`mouse.down`) and read the style while the
   * button is still held, which is the only way to observe the branch.
   */
  test("a plain <button> still animates — the patch must not regress it", async ({
    page,
  }) => {
    await page.goto("/")
    await awaitClientHandover(page)
    await expectCompiled(page, "active:scale-95")
    const id = await probe(page, "button", {
      type: "button",
      class: "active:scale-95",
    })

    const [x, y] = await centre(page, id)
    await page.mouse.move(x, y)
    await page.mouse.down()
    const scale = await computed(page, id, "scale")
    const active = await page.evaluate(
      (i) => document.getElementById(i)?.matches(":active") ?? false,
      id,
    )
    await page.mouse.up()

    expect(active, "the real press must set :active").toBe(true)
    expect(scale, "so a plain button keeps animating").toBe("0.95")
  })

  test("an engine-driven element ignores :active and answers to data-pressed", async ({
    page,
  }) => {
    // The engine writes `data-pressed` itself; native `:active` cannot be cleared
    // from JS and will not re-light on touch re-entry, which is why the variant
    // excludes any element carrying the engine marker.
    await page.goto("/")
    await awaitClientHandover(page)
    await expectCompiled(page, "active:scale-95")
    const id = await probe(page, "button", {
      type: "button",
      class: "active:scale-95",
      "data-press-engine": "",
    })

    const [x, y] = await centre(page, id)
    await page.mouse.move(x, y)
    await page.mouse.down()
    const scale = await computed(page, id, "scale")
    const active = await page.evaluate(
      (i) => document.getElementById(i)?.matches(":active") ?? false,
      id,
    )
    await page.mouse.up()

    expect(active, ":active still MATCHES — it is only excluded").toBe(
      true,
    )
    expect(scale, "…so the native branch must not fire").toBe("none")

    await page.evaluate(
      (i) => document.getElementById(i)?.setAttribute("data-pressed", ""),
      id,
    )
    expect(
      await computed(page, id, "scale"),
      "the engine branch is what drives it",
    ).toBe("0.95")
  })
})

test.describe("focus", () => {
  test("keyboard focus paints a ring; a mouse click does not", async ({
    page,
  }) => {
    // WCAG 2.4.7. The blanket `outline: none` reset that used to ship here left a
    // consumer's plain <button> with no visible focus indicator on any target,
    // keyboard included — a real accessibility regression, not a preference.
    await page.goto("/")
    await awaitClientHandover(page)
    const id = await probe(page, "button", { type: "button" })

    const [x, y] = await centre(page, id)
    await page.mouse.click(x, y)
    expect(
      await page.evaluate(
        (i) =>
          document.getElementById(i)?.matches(":focus-visible") ?? false,
        id,
      ),
      "a mouse click must not be focus-visible",
    ).toBe(false)
    // ⚠︎ `outline-width` is the WRONG property to assert. `outline: none` sets the
    // STYLE to none; the computed WIDTH stays at its initial `medium` (3px) in both
    // engines, so a width check reads 3px on a correctly-suppressed ring.
    expect(await computed(page, id, "outline-style")).toBe("none")

    await page.evaluate((i) => document.getElementById(i)?.blur(), id)
    await page.keyboard.press("Tab")
    // Tab order is the app's, so drive focus explicitly and then confirm the UA
    // classified it as keyboard-driven rather than asserting on tab position
    await page.locator(`#${id}`).press("Tab")
    await page.locator(`#${id}`).focus()
    await page.keyboard.press("Shift+Tab")
    await page.keyboard.press("Tab")

    const visible = await page.evaluate(
      (i) =>
        document.getElementById(i)?.matches(":focus-visible") ?? false,
      id,
    )
    test.skip(
      !visible,
      "the UA did not classify this focus as keyboard-driven — engine-dependent, cover it by hand on the focus lab page",
    )
    expect(
      await computed(page, id, "outline-style"),
      "keyboard focus must paint the replacement ring",
    ).toBe("solid")
  })
})

test.describe("safe-area utilities", () => {
  test("resolve to real lengths, and *-safe-or-N floors at N", async ({
    page,
  }) => {
    // The `safe-or` family is adaptv's own — it did not come from the plugin these
    // replaced — and it must use max(), not a var() fallback: the inset vars are
    // ALWAYS defined (0px at rest), so a fallback would never fire and the floor
    // would silently be 0 on exactly the devices that have no inset.
    await page.goto("/")
    await awaitClientHandover(page)
    await expectCompiled(page, "pb-safe")
    await expectCompiled(page, "pb-safe-or-4")

    const bare = await probe(page, "div", { class: "pb-safe" })
    const floored = await probe(page, "div", { class: "pb-safe-or-4" })

    expect(
      await computed(page, bare, "padding-bottom"),
      "a desktop viewport has no inset",
    ).toBe("0px")
    expect(
      await computed(page, floored, "padding-bottom"),
      "…and that is exactly the case the floor exists for",
    ).toBe("16px")
  })
})
