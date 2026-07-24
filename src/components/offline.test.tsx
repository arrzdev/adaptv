import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Offline } from "#adaptv/components/offline"

afterEach(() => {
  vi.unstubAllGlobals()
})

/**
 * Press the retry button the way a finger does.
 *
 * `fireEvent.click` does NOT work here: adaptv's `Button` commits on gesture
 * release via `useGestureEngine` (`onPointerUp`), not on the DOM `click` event —
 * that is deliberate, so a press survives a thumb-roll and can be cancelled by a
 * scroll take-over. A synthetic `click` bypasses the whole state machine.
 */
function pressRetry(): void {
  const button = screen.getByRole("button")
  //happy-dom has no Pointer Capture API; the engine claims the pointer on press
  //so the gesture can't be stolen mid-drag
  button.setPointerCapture ??= () => {}
  button.releasePointerCapture ??= () => {}

  //`isPrimary` must be explicit: synthetic PointerEvents default it to FALSE, and
  //the engine ignores non-primary pointers so a second finger can't fire a tap.
  const pointer = { pointerId: 1, button: 0, isPrimary: true }
  fireEvent.pointerDown(button, pointer)
  fireEvent.pointerUp(button, pointer)
}

describe("Offline — one component, two call sites", () => {
  //RENDERING §3.1.2. adaptv renders this when the app can't boot far enough for a
  //route to exist; the consumer renders the SAME component when a route mounted
  //fine but its data is unavailable. Every prop is optional, which is what lets
  //one component serve both without a framework-flavoured screen that looks
  //different from the app's own.
  it("renders with no props at all — adaptv's call site passes nothing", () => {
    render(<Offline />)
    expect(screen.getByRole("alert")).toBeTruthy()
  })

  it("calls the consumer's onRetry instead of reloading", () => {
    //the consumer's retry is a refetch or a router invalidate — reloading would
    //throw away the very state that makes in-place recovery better than a redirect
    const onRetry = vi.fn()
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })

    render(<Offline onRetry={onRetry} />)
    pressRetry()

    expect(onRetry).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
  })

  it("falls back to reloading when no onRetry is given", () => {
    //adaptv's own call site: the app never booted, so there is nothing to refetch
    //and a reload is the only meaningful recovery
    const reload = vi.fn()
    vi.stubGlobal("location", { reload })

    render(<Offline />)
    pressRetry()

    expect(reload).toHaveBeenCalledOnce()
  })

  it("announces itself to assistive tech", () => {
    //this replaces content the user was expecting; a silent swap strands a screen
    //reader user on a page that no longer says what they came for
    render(<Offline />)
    const alert = screen.getByRole("alert")
    expect(alert.getAttribute("aria-live")).toBe("polite")
  })

  it("accepts a custom title and description", () => {
    render(<Offline title="No signal" description="Try moving." />)
    expect(screen.getByText("No signal")).toBeTruthy()
    expect(screen.getByText("Try moving.")).toBeTruthy()
  })

  it("takes consumer classes on the root, per the styling contract", () => {
    const { container } = render(<Offline className="bg-red-500" />)
    expect(container.firstElementChild?.className).toContain("bg-red-500")
  })

  it("can render an error for debugging without exposing it by default", () => {
    //an error object often carries a URL, a token, or a stack. Showing it by
    //default would leak it into screenshots and support tickets.
    const { container } = render(
      <Offline error={new Error("secret-host")} />,
    )
    expect(container.textContent).not.toContain("secret-host")
  })
})
