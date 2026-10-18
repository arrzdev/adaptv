import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { resetBackChain } from "#adaptv/capabilities/back-chain"
import { Drawer } from "#adaptv/components/drawer"

//the caret repaint is a real DOM side effect irrelevant to focus
vi.mock("#adaptv/hooks/use-caret-repaint", () => ({
  beginCaretHold: () => () => {},
  preMuteCaret: () => {},
}))

/*
 * Drawer.Content is `role="dialog" aria-modal="true"`, so it owes a keyboard user what any
 * modal dialog owes (WAI-ARIA APG, dialog pattern): focus moves into it on open, Tab and
 * Shift+Tab stay inside it, Escape closes it, and focus goes back to what opened it. Before
 * this file the open path blurred the trigger and stopped there: focus sat on <body>, Tab
 * walked the page behind the sheet, and nothing put focus back on close.
 *
 * The trigger here is a plain button outside the drawer driving a controlled `open`, the way
 * the docs menu and the landing sheet use it, so the return target cannot come from
 * Drawer.Trigger. jsdom has no layout, so "tabbable" must not depend on it.
 */

afterEach(() => {
  resetBackChain()
})

function Sheet({ withAutofocus = false }: { withAutofocus?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Behind</button>
      <Drawer open={open} onOpenChange={setOpen}>
        <Drawer.Portal>
          <Drawer.Overlay />
          <Drawer.Content>
            <Drawer.Title>Sheet</Drawer.Title>
            <a href="#first">First</a>
            {withAutofocus ? (
              <input aria-label="Name" data-autofocus />
            ) : null}
            <button type="button" disabled>
              Disabled
            </button>
            <Drawer.Close>Last</Drawer.Close>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>
    </>
  )
}

function panel() {
  return screen.getByRole("dialog", { hidden: true })
}

async function openFromTrigger() {
  const trigger = screen.getByRole("button", { name: "Open" })
  act(() => trigger.focus())
  fireEvent.click(trigger)
  await vi.waitFor(() =>
    expect(panel().getAttribute("aria-hidden")).toBe("false"),
  )
  return trigger
}

function press(key: string, init: { shiftKey?: boolean } = {}) {
  const target = document.activeElement ?? document.body
  return fireEvent.keyDown(target, { key, code: key, ...init })
}

describe("Drawer focus management", () => {
  it("moves focus into the dialog when it opens", async () => {
    render(<Sheet />)
    await openFromTrigger()

    await vi.waitFor(() =>
      expect(panel().contains(document.activeElement)).toBe(true),
    )
  })

  it("focuses the [data-autofocus] field over the first tabbable", async () => {
    render(<Sheet withAutofocus />)
    await openFromTrigger()

    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "Name" }),
      ),
    )
  })

  it("wraps Tab from the last tabbable to the first, and Shift+Tab back", async () => {
    render(<Sheet />)
    await openFromTrigger()
    const first = screen.getByRole("link", { name: "First" })
    const last = screen.getByRole("button", { name: "Last" })

    act(() => last.focus())
    const tab = press("Tab")
    expect(tab).toBe(false) //default prevented: the browser must not leave the dialog
    expect(document.activeElement).toBe(first)

    const shiftTab = press("Tab", { shiftKey: true })
    expect(shiftTab).toBe(false)
    expect(document.activeElement).toBe(last)
  })

  it("pulls a Tab that starts outside the dialog back inside", async () => {
    render(<Sheet />)
    await openFromTrigger()

    act(() => screen.getByRole("button", { name: "Behind" }).focus())
    press("Tab")
    expect(panel().contains(document.activeElement)).toBe(true)
  })

  it("closes on Escape and returns focus to the trigger", async () => {
    render(<Sheet />)
    const trigger = await openFromTrigger()
    await vi.waitFor(() =>
      expect(panel().contains(document.activeElement)).toBe(true),
    )

    press("Escape")

    await vi.waitFor(() =>
      expect(panel().getAttribute("aria-hidden")).toBe("true"),
    )
    expect(document.activeElement).toBe(trigger)
  })

  it("returns focus to the trigger when closed by Drawer.Close", async () => {
    render(<Sheet />)
    const trigger = await openFromTrigger()

    fireEvent.click(screen.getByRole("button", { name: "Last" }))

    await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it("does not trap or answer Escape while closed", () => {
    render(<Sheet />)
    const behind = screen.getByRole("button", { name: "Behind" })
    act(() => behind.focus())

    expect(press("Tab")).toBe(true)
    expect(press("Escape")).toBe(true)
    expect(document.activeElement).toBe(behind)
  })

  it("Escape closes only the top drawer of a nested pair", async () => {
    function Pair() {
      const [outer, setOuter] = useState(true)
      const [inner, setInner] = useState(true)
      return (
        <Drawer open={outer} onOpenChange={setOuter}>
          <Drawer.Portal>
            <Drawer.Content>
              <Drawer.Title>Outer</Drawer.Title>
              <button type="button">Outer button</button>
              <Drawer.Nested open={inner} onOpenChange={setInner}>
                <Drawer.Portal>
                  <Drawer.Content>
                    <Drawer.Title>Inner</Drawer.Title>
                    <button type="button">Inner button</button>
                  </Drawer.Content>
                </Drawer.Portal>
              </Drawer.Nested>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer>
      )
    }
    render(<Pair />)
    const [outerPanel, innerPanel] = screen.getAllByRole("dialog", {
      hidden: true,
    })
    await vi.waitFor(() =>
      expect(innerPanel.getAttribute("aria-hidden")).toBe("false"),
    )

    press("Escape")

    await vi.waitFor(() =>
      expect(innerPanel.getAttribute("aria-hidden")).toBe("true"),
    )
    expect(outerPanel.getAttribute("aria-hidden")).toBe("false")
  })
})
