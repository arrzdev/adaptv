import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BootError,
  bootErrorRetryProps,
} from "#adaptv/components/boot-error"
import { BOOT_RETRY_ATTR } from "#adaptv/shell/boot-fallback"

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Press the button the way a finger does — `fireEvent.click` does not work,
 * because adaptv's `Button` commits on gesture release (`onPointerUp`) rather than
 * on the DOM click event. Same helper as `offline.test.tsx`, same reason.
 */
function pressRetry(): void {
  const button = screen.getByRole("button")
  button.setPointerCapture ??= () => {}
  button.releasePointerCapture ??= () => {}
  const pointer = { pointerId: 1, button: 0, isPrimary: true }
  fireEvent.pointerDown(button, pointer)
  fireEvent.pointerUp(button, pointer)
}

describe("BootError — the default boot failure screen", () => {
  it("renders with no props at all — the prerender passes almost nothing", () => {
    render(<BootError />)
    expect(screen.getByRole("alert")).toBeTruthy()
  })

  it("reloads, which is the only recovery that exists here", () => {
    //no `reset`, because there is nothing to reset to: this screen renders when
    //the bundle never ran, so there is no React tree and no state to keep
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })

    render(<BootError />)
    pressRetry()

    expect(reload).toHaveBeenCalledOnce()
  })

  it("carries the adaptv mark, like the dev build's own error page", () => {
    //these are the two screens adaptv shows when its own shell could not start;
    //they should read as one thing. An app that wants its own branding here
    //overrides `bootErrorScreen`, which is the point of the slot.
    const { container } = render(<BootError />)
    expect(container.querySelector("svg")).not.toBeNull()
    expect(screen.getByText("adaptv")).toBeTruthy()
  })

  it("announces itself assertively to assistive tech", () => {
    render(<BootError />)
    expect(screen.getByRole("alert").getAttribute("aria-live")).toBe(
      "assertive",
    )
  })

  it("accepts custom copy", () => {
    render(
      <BootError
        title="Broken"
        description="We are on it."
        retryLabel="Reload"
      />,
    )
    expect(screen.getByText("Broken")).toBeTruthy()
    expect(screen.getByText("We are on it.")).toBeTruthy()
    expect(screen.getByText("Reload")).toBeTruthy()
  })

  it("takes consumer classes on the root, per the styling contract", () => {
    const { container } = render(<BootError className="bg-red-500" />)
    expect(container.firstElementChild?.className).toContain("bg-red-500")
  })

  it("NEVER shows the boot code, even when given one", () => {
    //deliberate: whether a code helps a user or just alarms them is a product
    //decision, and it belongs to whoever overrides `bootErrorScreen`. The prop
    //exists so they can branch on it — not so the framework can print it.
    const { container } = render(<BootError code="BOOT-LOAD" />)
    expect(container.textContent).not.toContain("BOOT-LOAD")
  })

  it("renders identically whatever the code is", () => {
    //load-bearing beyond looks: the four prerendered variants collapse to one
    //copy in the document precisely because this component ignores `code`
    const a = render(<BootError code="BOOT-LOAD" />).container.innerHTML
    const b = render(<BootError code="BOOT-STALL" />).container.innerHTML
    expect(a).toBe(b)
  })

  it("exports retry props that match what the watchdog narrows on", () => {
    //optional for a one-button screen — the watchdog reloads on any button — but
    //pinned because the constant and its consumer live in different files, and a
    //rename on one side would otherwise go unnoticed until a real boot failure
    expect(bootErrorRetryProps).toEqual({ [BOOT_RETRY_ATTR]: "" })

    const { container } = render(<BootError />)
    expect(container.querySelector(`[${BOOT_RETRY_ATTR}]`)).not.toBeNull()
  })
})
