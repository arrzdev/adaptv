import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * LabRow at a phone's width — the label and the value never paint over each other.
 *
 * On an iOS 16.2 simulator (390x844 pt, Safari) `/lab/button`'s "styling hooks"
 * row drew its badge 16pt over its own label. The cause was the lab kit's row, not
 * the page: the label was `shrink-0` and could not wrap, the badge was `shrink-0`
 * and could not shrink, and the row did not wrap either — so whenever the two did
 * not fit side by side, the value span shrank to what was left and its badge
 * overflowed it towards the label (`justify-end` overflows to the START side), or
 * a label wider than the row pushed the value out of the row altogether. A walk of
 * every lab page at 390px found the same collision on four rows, a fifth whose
 * label pushed its value out of the row, and three more whose badge already
 * spilled out of its own box and was only saved by the gap.
 *
 * Every row that walk found is pinned here, in both projects, at the simulator's
 * viewport (on main only webkit fails `/lab/safe-area`'s row; its badge fits in
 * chromium). The geometry is read from the painted extent of each side (the element
 * plus every descendant), because the badge is what overflows — the value span's
 * own box sat politely next to the label the whole time. `expectedValue` is the
 * premise: a row still on its "measuring…" placeholder is narrower than the
 * settled one, and would pass without testing anything.
 *
 * The same walk found the plain-string half of the bug: a label that left no
 * room squeezed "false" to a zero-width box, "18px" to "1…" and a CSS value to
 * 5px. Those rows are pinned on the floor LabRow now gives a plain value.
 */

test.use({ viewport: { width: 390, height: 844 } })

const ROWS: {
  route: string
  label: string
  expectedValue: RegExp
}[] = [
  {
    route: "/lab/button",
    label: "styling hooks",
    expectedValue: /^data-press-engine, data-pressed$/,
  },
  {
    route: "/lab/back-chain",
    label: "hardware back",
    expectedValue: /^browser back — not this chain$/,
  },
  {
    route: "/lab/keyboard",
    label: "willOpenVirtualKeyboard(<input type=checkbox>)",
    expectedValue: /^(true|false)$/,
  },
  {
    route: "/lab/screens",
    label: "[data-adaptv-splash] still in the DOM",
    expectedValue: /^gone, as expected$/,
  },
  {
    route: "/lab/service-worker",
    label: "useServiceWorkerUpdate().updateAvailable",
    expectedValue: /^false$/,
  },
  {
    route: "/lab/cascade-layers",
    label: "verdict",
    expectedValue: /^the app won, at lower specificity$/,
  },
  {
    route: "/lab/press-states",
    label: ":active on last press-down",
    expectedValue: /^not pressed yet$/,
  },
  {
    route: "/lab/safe-area",
    label: "pt-safe-offset-4",
    expectedValue: /px · expected /,
  },
  //plain-string values a long label squeezed to an ellipsis, or to nothing
  {
    route: "/lab/text",
    label: "scaleWithSystem text-lg — built × factor",
    expectedValue: /^\d+(\.\d+)?px$/,
  },
  {
    route: "/lab/text",
    label: "@supports (-webkit-touch-callout: none)",
    expectedValue: /^(true|false)$/,
  },
  {
    route: "/lab/cascade-layers",
    label: "-webkit-tap-highlight-color (overridden link)",
    expectedValue: /^(rgba?\(.+\)|not reported here)$/,
  },
  {
    route: "/lab/view-scroll",
    label: "a depth that changes with a variant",
    expectedValue: /^className=/,
  },
]

/** LabRow's floor for a plain value beside its label, in characters (lab-kit.tsx). */
const PLAIN_VALUE_FLOOR_CH = 12

for (const { route, label, expectedValue } of ROWS) {
  test(`${route} "${label}": label and value stay apart and inside the row`, async ({
    page,
  }) => {
    await page.goto(route)
    await awaitClientHandover(page)

    const labelEl = page.getByText(label, { exact: true })
    //the row is the label's parent and the value its next sibling (LabRow's shape)
    const valueEl = labelEl.locator("xpath=following-sibling::*[1]")
    await expect(valueEl).toHaveText(expectedValue)
    await labelEl.scrollIntoViewIfNeeded()

    const geometry = await labelEl.evaluate((labelNode) => {
      type Box = {
        left: number
        right: number
        top: number
        bottom: number
      }
      const box = (el: Element): Box => {
        const { left, right, top, bottom } = el.getBoundingClientRect()
        return { left, right, top, bottom }
      }
      //what the element actually paints: its box plus every descendant's
      const extent = (el: Element): Box => {
        const out = box(el)
        for (const child of el.querySelectorAll("*")) {
          const b = child.getBoundingClientRect()
          if (b.width === 0 && b.height === 0) continue
          out.left = Math.min(out.left, b.left)
          out.right = Math.max(out.right, b.right)
          out.top = Math.min(out.top, b.top)
          out.bottom = Math.max(out.bottom, b.bottom)
        }
        return out
      }
      const row = labelNode.parentElement as Element
      const valueNode = labelNode.nextElementSibling as Element
      return {
        row: box(row),
        label: extent(labelNode),
        valueBox: box(valueNode),
        value: extent(valueNode),
        //a plain value is a text node alone; its elision is scrollWidth vs clientWidth
        plain:
          valueNode.children.length === 0
            ? {
                chars: (valueNode.textContent ?? "").length,
                clientWidth: valueNode.clientWidth,
                scrollWidth: valueNode.scrollWidth,
              }
            : null,
      }
    })

    //sub-pixel slack for layout rounding, nothing more
    const SLACK = 0.5
    const { row, label: l, value: v, valueBox } = geometry
    const detail = JSON.stringify(geometry)
    expect(row.right - row.left, "the row rendered").toBeGreaterThan(0)

    const overlapX = Math.min(l.right, v.right) - Math.max(l.left, v.left)
    const overlapY = Math.min(l.bottom, v.bottom) - Math.max(l.top, v.top)
    expect(
      overlapX > SLACK && overlapY > SLACK,
      `the label and the value paint over each other: ${detail}`,
    ).toBe(false)

    for (const [name, side] of [
      ["label", l],
      ["value", v],
    ] as const) {
      expect(
        side.left >= row.left - SLACK && side.right <= row.right + SLACK,
        `the ${name} spills out of its row: ${detail}`,
      ).toBe(true)
    }

    expect(
      v.left >= valueBox.left - SLACK && v.right <= valueBox.right + SLACK,
      `the value's content overflows the value's own box: ${detail}`,
    ).toBe(true)

    //a plain value may truncate, but never below its floor: its whole text when it
    //is short, PLAIN_VALUE_FLOOR_CH characters when it is long (the font is mono,
    //so a character is scrollWidth / chars)
    if (geometry.plain) {
      const { chars, clientWidth, scrollWidth } = geometry.plain
      const floor =
        (scrollWidth / chars) * Math.min(chars, PLAIN_VALUE_FLOOR_CH)
      expect(
        clientWidth + 1,
        `the plain value is squeezed below its floor: ${detail}`,
      ).toBeGreaterThanOrEqual(floor)
    }
  })
}
