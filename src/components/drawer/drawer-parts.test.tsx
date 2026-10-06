import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, render } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { gestureController } from "#adaptv/capabilities/gesture-controller"
import type { DrawerHandle } from "#adaptv/components/drawer"
import { Drawer } from "#adaptv/components/drawer"

//the caret repaint is a real DOM side effect irrelevant to the styling under test
vi.mock("#adaptv/hooks/use-caret-repaint", () => ({
  beginCaretHold: () => () => {},
  preMuteCaret: () => {},
}))

/*
 * The drawer's parts under docs/decisions/styling.md §2: each carries `data-adaptv="drawer"` +
 * `data-part`, emits no class of its own (the default look is a `:where()` rule in
 * styles/drawer.css), and holds its locks as inline style a consumer `style` cannot beat. Which
 * computed value wins in a real browser is the e2e precedence suite's job; these pin the DOM.
 */

const DRAWER_CSS = readFileSync(
  join(process.cwd(), "src/styles/drawer.css"),
  "utf8",
)

function measureContentBox() {
  const measure = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(
    HTMLElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(function (this: HTMLElement) {
    return this.parentElement?.hasAttribute("data-pwa-drawer")
      ? DOMRect.fromRect({ width: 390, height: 400 })
      : measure.call(this)
  })
}

async function mountOpenDrawer(
  ui: (parts: typeof Drawer) => React.ReactNode,
  props: { disableDrag?: boolean } = {},
) {
  measureContentBox()
  const onAnimationEnd = vi.fn()
  const drawer = createRef<DrawerHandle>()
  const view = render(
    <Drawer ref={drawer} onAnimationEnd={onAnimationEnd} {...props}>
      <Drawer.Portal>{ui(Drawer)}</Drawer.Portal>
    </Drawer>,
  )
  act(() => drawer.current?.show())
  await vi.waitFor(() => expect(onAnimationEnd).toHaveBeenCalledWith(true))
  const part = (name: string) => {
    const el = view.baseElement.querySelector<HTMLElement>(
      `[data-adaptv="drawer"][data-part="${name}"]`,
    )
    if (!el) throw new Error(`no ${name} part`)
    return el
  }
  return { ...view, part }
}

afterEach(() => {
  vi.restoreAllMocks()
  const held = gestureController.getCaptured()
  if (held) gestureController.release(held)
})

describe("Drawer parts — default rules in the layer, locks inline", () => {
  it("names every part and emits no class of its own", async () => {
    const { part } = await mountOpenDrawer((D) => (
      <>
        <D.Overlay />
        <D.Content>
          <p>body</p>
          <D.Footer>actions</D.Footer>
        </D.Content>
      </>
    ))
    for (const name of [
      "overlay",
      "content",
      "body",
      "header",
      "handle",
      "scroller",
      "shell",
      "footer",
    ]) {
      expect(part(name).getAttribute("class") ?? "", name).toBe("")
    }
    //the engine's attributes stay where the e2e and drawer.css find them
    expect(part("overlay").hasAttribute("data-pwa-drawer-overlay")).toBe(
      true,
    )
    expect(part("content").hasAttribute("data-pwa-drawer")).toBe(true)
  })

  it("passes consumer classes through untouched", async () => {
    const { part } = await mountOpenDrawer((D) => (
      <>
        <D.Overlay className="bg-black/60" />
        <D.Content className="rounded-t-3xl" scrollClassName="px-4">
          <p>body</p>
          <D.Footer className="pb-safe">actions</D.Footer>
        </D.Content>
      </>
    ))
    expect(part("overlay").className).toBe("bg-black/60")
    expect(part("content").className).toBe("rounded-t-3xl")
    expect(part("scroller").className).toBe("px-4")
    expect(part("footer").className).toBe("pb-safe")
  })

  it("holds the engine's geometry and the scroll model against a consumer style", async () => {
    const { part } = await mountOpenDrawer((D) => (
      <>
        <D.Overlay
          style={{ position: "static", zIndex: 0, inset: "auto" }}
        />
        <D.Content
          style={{
            position: "static",
            zIndex: 0,
            display: "block",
            maxHeight: "85dvh",
            height: "50vh",
            minHeight: "10px",
          }}
        >
          <D.Shell style={{ display: "block" }}>shell</D.Shell>
          <D.Footer style={{ flexShrink: 1 }}>actions</D.Footer>
        </D.Content>
      </>
    ))
    const overlay = part("overlay")
    expect(overlay.style.position).toBe("fixed")
    expect(overlay.style.zIndex).toBe("50")
    expect(overlay.style.inset).toMatch(/^0(px)?$/)
    const panel = part("content")
    expect(panel.style.position).toBe("fixed")
    expect(panel.style.zIndex).toBe("51")
    expect(panel.style.display).toBe("flex")
    expect(panel.style.flexDirection).toBe("column")
    expect(panel.style.height).toBe("auto")
    expect(panel.style.minHeight).toMatch(/^0(px)?$/)
    expect(panel.style.maxHeight).toBe("none")
    const scroller = part("scroller")
    expect(scroller.style.overflowY).toBe("auto")
    expect(scroller.style.overflowX).toBe("hidden")
    expect(scroller.style.overscrollBehaviorY).toBe("none")
    expect(scroller.style.minHeight).toMatch(/^0(px)?$/)
    expect(part("footer").style.flexShrink).toBe("0")
    const header = part("header")
    expect(header.style.display).toBe("flex")
    expect(header.style.flexShrink).toBe("0")
  })

  it("hands the header's touch stream to the engine only while drag is live", async () => {
    const live = await mountOpenDrawer((D) => <D.Content>body</D.Content>)
    expect(live.part("header").style.touchAction).toBe("none")
    expect(live.part("header").hasAttribute("data-draggable")).toBe(true)
    live.unmount()
    vi.restoreAllMocks()

    const locked = await mountOpenDrawer(
      (D) => <D.Content>body</D.Content>,
      {
        disableDrag: true,
      },
    )
    expect(locked.part("header").style.touchAction).toBe("")
    expect(locked.part("header").hasAttribute("data-draggable")).toBe(
      false,
    )
  })

  it("keeps the panel's look and promotion hint a default the consumer can turn off", () => {
    const rule =
      /:where\(\[data-adaptv="drawer"\]\[data-part="content"\]\) \{([^}]*)\}/.exec(
        DRAWER_CSS,
      )?.[1]
    expect(rule).toContain("will-change: transform;")
    expect(rule).toContain("background-color: var(--color-white, #fff);")
    //nothing the engine or the cap depends on is a default
    expect(rule).not.toMatch(
      /\b(position|z-index|height|max-height|display):/,
    )
  })
})
