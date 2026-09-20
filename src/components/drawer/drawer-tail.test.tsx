import { act, render } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { gestureController } from "#adaptv/capabilities/gesture-controller"
import type { DrawerHandle } from "#adaptv/components/drawer"
import { Drawer } from "#adaptv/components/drawer"

//the caret repaint is a real DOM side effect irrelevant to the geometry under test
vi.mock("#adaptv/hooks/use-caret-repaint", () => ({
  beginCaretHold: () => () => {},
  preMuteCaret: () => {},
}))

//happy-dom lays nothing out, so the engine would measure a 0px sheet and never open
const CONTENT_HEIGHT = 400

/*
 * The sheet's hidden tail hangs OFF the panel's box.
 *
 * Safari on iOS 26 colours its bottom toolbar from the fixed element it finds at the bottom edge
 * of the viewport, and refuses one whose border box is taller than 1.05 viewports (WebKit's
 * `LocalFrameView::fixedContainerEdges`, the `TooLarge` branch). The tail used to be a spacer
 * inside the panel with the panel anchored at `bottom: -excess`, which made a form-sized sheet
 * ~1.3 viewports tall: Safari found nothing at the edge, fell back to the page colour, and the
 * toolbar sat in the theme colour under a white sheet. Measured on an iOS 26.1 simulator and
 * recorded in docs/decisions/register.md B33.
 *
 * So the panel sits ON the fold and the tail is an absolutely positioned child below it. These
 * pin the structure; the compiled rule is pinned in styles/drawer.test.ts and the on-screen
 * geometry in playground/e2e/drawer-tail.spec.ts.
 */

function measureContentBox() {
  const measure = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(
    HTMLElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(function (this: HTMLElement) {
    return this.parentElement?.hasAttribute("data-pwa-drawer")
      ? DOMRect.fromRect({ width: 390, height: CONTENT_HEIGHT })
      : measure.call(this)
  })
}

async function mountOpenDrawer() {
  measureContentBox()
  const onAnimationEnd = vi.fn()
  const drawer = createRef<DrawerHandle>()
  const { baseElement } = render(
    <Drawer ref={drawer} onAnimationEnd={onAnimationEnd}>
      <Drawer.Portal>
        <Drawer.Overlay />
        <Drawer.Content>
          <p>body</p>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer>,
  )
  act(() => drawer.current?.show())
  await vi.waitFor(() => expect(onAnimationEnd).toHaveBeenCalledWith(true))
  const panel = baseElement.querySelector<HTMLElement>("[data-pwa-drawer]")
  if (!panel) throw new Error("drawer did not mount")
  return panel
}

afterEach(() => {
  vi.restoreAllMocks()
  const held = gestureController.getCaptured()
  if (held) gestureController.release(held)
})

describe("the drawer's hidden tail", () => {
  it("anchors the panel ON the fold, never below it", async () => {
    const panel = await mountOpenDrawer()
    //`bottom: -excess` is the regression: it puts the tail inside the panel's box
    expect(Number.parseFloat(panel.style.bottom)).toBe(0)
  })

  it("is the panel's last child, sized to the excess, and hidden from assistive tech", async () => {
    const panel = await mountOpenDrawer()
    const tail = panel.querySelector<HTMLElement>("[data-pwa-drawer-tail]")
    if (!tail) throw new Error("no tail")
    expect(panel.lastElementChild).toBe(tail)
    expect(tail.getAttribute("aria-hidden")).toBe("true")
    //the engine's reserve: 55% of the visual viewport, rounded up (DRAWER_EXCESS_HEIGHT_CAP_FRACTION)
    const viewport = window.visualViewport?.height ?? window.innerHeight
    expect(Number.parseFloat(tail.style.height)).toBe(
      Math.ceil(viewport * 0.55),
    )
    //no spacer left in the flex stack: the tail is the ONLY thing after the content box
    expect(panel.childElementCount).toBe(2)
  })

  it("closes by the panel's own height — the tail is not travel", async () => {
    measureContentBox()
    const onAnimationEnd = vi.fn()
    const drawer = createRef<DrawerHandle>()
    const { baseElement } = render(
      <Drawer ref={drawer} onAnimationEnd={onAnimationEnd}>
        <Drawer.Portal>
          <Drawer.Overlay />
          <Drawer.Content>
            <p>body</p>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
    )
    act(() => drawer.current?.show())
    await vi.waitFor(() =>
      expect(onAnimationEnd).toHaveBeenCalledWith(true),
    )
    const panel = baseElement.querySelector<HTMLElement>(
      "[data-pwa-drawer]",
    )
    if (!panel) throw new Error("drawer did not mount")
    act(() => drawer.current?.hide())
    //the closed position is aimed at the panel's on-screen height (`--pwa-drawer-to`); with a
    //spacer in the box that was `panel − excess`, and a panel measured without the tail must
    //give the same number without any subtraction
    await vi.waitFor(() =>
      expect(
        Number.parseFloat(panel.style.getPropertyValue("--pwa-drawer-to")),
      ).toBe(CONTENT_HEIGHT),
    )
  })
})
