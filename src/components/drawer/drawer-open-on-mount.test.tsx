import { act, render } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { gestureController } from "#adaptv/capabilities/gesture-controller"
import { Drawer } from "#adaptv/components/drawer"

//the caret repaint is a real DOM side effect irrelevant to the gesture under test
vi.mock("#adaptv/hooks/use-caret-repaint", () => ({
  beginCaretHold: () => () => {},
  preMuteCaret: () => {},
}))

//happy-dom lays nothing out, so the engine would measure a 0px sheet and never close from a drag.
//400px of content is the geometry the release decision reads (closedY = 400).
const CONTENT_HEIGHT = 400

/*
 * A drawer that is ALREADY open when it mounts (`defaultOpen`, or `open` true on the first render)
 * renders its panel twice. The portal target is only known after mount, so the first commit puts
 * the tree inline, and the next one moves it into `document.body` — which React does by unmounting
 * the inline panel and mounting a new one. The engine does not remount, so anything it bound to
 * the first panel element in an effect keyed only on `mounted` stays bound to a detached node.
 *
 * A drawer opened after mount never sees the inline commit (the portal target is set by then),
 * which is why every other drawer test, and the control below, is green either way.
 */

function touch(target: Element, clientY: number): Touch {
  return new Touch({ identifier: 1, target, clientX: 200, clientY })
}

function dispatchTouch(
  target: Element,
  type: "touchstart" | "touchmove" | "touchend",
  clientY: number,
) {
  const point = touch(target, clientY)
  act(() => {
    target.dispatchEvent(
      new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: type === "touchend" ? [] : [point],
        changedTouches: [point],
      }),
    )
  })
}

function translateY(panel: HTMLElement): number {
  const transform = panel.style.transform
  if (transform === "") return 0
  const match = /translate3d\(0(?:px)?, (-?[\d.]+)px, 0(?:px)?\)/.exec(
    transform,
  )
  if (!match) throw new Error(`unexpected transform "${transform}"`)
  return Number(match[1])
}

function measureContentBox() {
  //the content box is the panel's first child; it has to measure before the open can even start
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

function sheet(children: ReactNode) {
  return (
    <Drawer.Portal>
      <Drawer.Overlay />
      <Drawer.Content>
        {children}
        <p data-testid="body">body</p>
      </Drawer.Content>
    </Drawer.Portal>
  )
}

/** The live panel, and the premise every test here rests on: it sits in the portal, on screen. */
function livePanel(baseElement: HTMLElement) {
  const panels = baseElement.querySelectorAll<HTMLElement>(
    "[data-pwa-drawer]",
  )
  expect(panels).toHaveLength(1)
  const panel = panels[0]
  expect(panel.parentElement).toBe(document.body)
  expect(panel.dataset.open).toBe("true")
  const body = panel.querySelector<HTMLElement>("[data-testid=body]")
  if (!body) throw new Error("the sheet has no body")
  return { panel, body }
}

async function mountOpenOnMount() {
  measureContentBox()
  const onOpenChange = vi.fn()
  const onAnimationEnd = vi.fn()
  const { baseElement } = render(
    <Drawer
      defaultOpen
      onOpenChange={onOpenChange}
      onAnimationEnd={onAnimationEnd}
    >
      {sheet(null)}
    </Drawer>,
  )
  await vi.waitFor(() => expect(onAnimationEnd).toHaveBeenCalledWith(true))
  return { ...livePanel(baseElement), onOpenChange }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  //a test that fails mid-gesture must not leave the shared arbiter held for the next one
  const held = gestureController.getCaptured()
  if (held) gestureController.release(held)
})

describe("a drawer open on mount", () => {
  it("control: a drawer opened by its trigger follows the finger and closes from a long drag", async () => {
    measureContentBox()
    const onOpenChange = vi.fn()
    const onAnimationEnd = vi.fn()
    const { baseElement, getByRole } = render(
      <Drawer onOpenChange={onOpenChange} onAnimationEnd={onAnimationEnd}>
        <Drawer.Trigger>open</Drawer.Trigger>
        {sheet(null)}
      </Drawer>,
    )
    act(() => getByRole("button", { name: "open" }).click())
    await vi.waitFor(() =>
      expect(onAnimationEnd).toHaveBeenCalledWith(true),
    )
    onOpenChange.mockClear()
    const { panel, body } = livePanel(baseElement)

    dispatchTouch(body, "touchstart", 100)
    dispatchTouch(body, "touchmove", 110)
    dispatchTouch(body, "touchmove", 250)
    expect(translateY(panel)).toBe(140)
    dispatchTouch(body, "touchmove", 480)
    dispatchTouch(body, "touchend", 480)
    await vi.waitFor(() =>
      expect(onOpenChange).toHaveBeenCalledWith(false),
    )
  })

  it("follows the finger, and a long drag closes it", async () => {
    const { panel, body, onOpenChange } = await mountOpenOnMount()

    dispatchTouch(body, "touchstart", 100)
    //past the 4px slop: the drag commits and anchors at this finger position
    dispatchTouch(body, "touchmove", 110)
    dispatchTouch(body, "touchmove", 250)
    expect(translateY(panel)).toBe(140)

    dispatchTouch(body, "touchmove", 480)
    expect(translateY(panel)).toBe(370)
    dispatchTouch(body, "touchend", 480)
    await vi.waitFor(() =>
      expect(onOpenChange).toHaveBeenCalledWith(false),
    )
  })

  it("watches the content box that is on screen, not the one the portal replaced", async () => {
    //happy-dom never fires a ResizeObserver, so record what each one is watching instead
    const watched = new Set<Element>()
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private targets: Element[] = []
        observe(target: Element) {
          this.targets.push(target)
          watched.add(target)
        }
        unobserve(target: Element) {
          watched.delete(target)
        }
        disconnect() {
          for (const target of this.targets) watched.delete(target)
          this.targets = []
        }
      },
    )
    const { panel } = await mountOpenOnMount()

    const content = panel.firstElementChild
    expect(content).not.toBeNull()
    //the content's height changing with no viewport resize (a consumer's padding swap, a picker
    //expanding) is only ever heard through this observer
    expect([...watched]).toContain(content)
    expect([...watched].every((target) => target.isConnected)).toBe(true)
  })
})
