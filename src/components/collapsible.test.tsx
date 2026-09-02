import { act, fireEvent, render } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  Collapsible,
  useCollapsible,
} from "#adaptv/components/collapsible"

function parts(container: HTMLElement) {
  const root = container.querySelector<HTMLElement>(
    '[data-adaptv="collapsible"]',
  )
  const trigger = container.querySelector<HTMLButtonElement>(
    '[data-adaptv="collapsible-trigger"]',
  )
  const panel = container.querySelector<HTMLElement>(
    '[data-adaptv="collapsible-panel"]',
  )
  if (!root || !trigger || !panel) throw new Error("parts missing")
  return { root, trigger, panel }
}

function Basic(props: Parameters<typeof Collapsible>[0]) {
  return (
    <Collapsible {...props}>
      <Collapsible.Trigger>Details</Collapsible.Trigger>
      <Collapsible.Panel>
        <p>Body</p>
      </Collapsible.Panel>
    </Collapsible>
  )
}

/**
 * A `getAnimations` that reports one live CSS transition on `height` while
 * `running.value` is true. happy-dom has no animations at all, so this is the
 * only way to reach the asynchronous settle path.
 */
function fakeHeightTransition(
  panel: HTMLElement,
  running: { value: boolean },
) {
  Object.defineProperty(panel, "getAnimations", {
    configurable: true,
    value: () =>
      running.value
        ? [{ transitionProperty: "height", playState: "running" }]
        : [],
  })
}

/**
 * The panel's phase as the DOM spells it: two presence attributes, never both,
 * neither at rest (docs/decisions/styling.md §3.1).
 */
function phase(panel: HTMLElement): "opening" | "closing" | null {
  const opening = panel.hasAttribute("data-collapsible-opening")
  const closing = panel.hasAttribute("data-collapsible-closing")
  if (opening && closing) throw new Error("opening and closing at once")
  return opening ? "opening" : closing ? "closing" : null
}

function transitionEvent(type: string, propertyName: string): Event {
  const event = new Event(type, { bubbles: true })
  Object.defineProperty(event, "propertyName", { value: propertyName })
  return event
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("Collapsible — state", () => {
  it("is closed by default and opens on a trigger press", () => {
    const { container } = render(<Basic />)
    const { root, trigger, panel } = parts(container)
    expect(root.hasAttribute("data-collapsible-open")).toBe(false)
    expect(trigger.hasAttribute("data-collapsible-open")).toBe(false)
    expect(panel.hasAttribute("data-collapsible-open")).toBe(false)
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
    expect(panel.hasAttribute("hidden")).toBe(true)

    fireEvent.click(trigger)

    expect(root.hasAttribute("data-collapsible-open")).toBe(true)
    expect(trigger.hasAttribute("data-collapsible-open")).toBe(true)
    expect(panel.hasAttribute("data-collapsible-open")).toBe(true)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(panel.hasAttribute("hidden")).toBe(false)

    fireEvent.click(trigger)
    expect(panel.hasAttribute("data-collapsible-open")).toBe(false)
    expect(panel.hasAttribute("hidden")).toBe(true)
  })

  //docs/decisions/styling.md §3.1: a valueless attribute namespaced per component,
  //and `data-disabled` verbatim beside the native attribute
  it("spells open and disabled as presence attributes on every part", () => {
    const { container } = render(<Basic defaultOpen disabled />)
    const { root, trigger, panel } = parts(container)
    for (const part of [root, trigger, panel]) {
      expect(part.getAttribute("data-collapsible-open")).toBe("")
    }
    expect(root.getAttribute("data-disabled")).toBe("")
    expect(trigger.getAttribute("data-disabled")).toBe("")
    expect(trigger.disabled).toBe(true)
    expect(panel.hasAttribute("data-disabled")).toBe(false)
  })

  it("marks only the trigger when the trigger itself is disabled", () => {
    const { container } = render(
      <Collapsible>
        <Collapsible.Trigger disabled>Details</Collapsible.Trigger>
        <Collapsible.Panel>Body</Collapsible.Panel>
      </Collapsible>,
    )
    const { root, trigger } = parts(container)
    expect(trigger.getAttribute("data-disabled")).toBe("")
    expect(trigger.disabled).toBe(true)
    expect(root.hasAttribute("data-disabled")).toBe(false)
  })

  it("starts open with defaultOpen", () => {
    const { container } = render(<Basic defaultOpen />)
    const { trigger, panel } = parts(container)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(panel.hasAttribute("hidden")).toBe(false)
    expect(panel.hasAttribute("data-collapsible-open")).toBe(true)
  })

  it("lets a controlled `open` win and reports through onOpenChange", () => {
    const onOpenChange = vi.fn()
    const { container, rerender } = render(
      <Basic open={false} onOpenChange={onOpenChange} />,
    )
    const { trigger, panel } = parts(container)

    fireEvent.click(trigger)
    //the owner was told, and the owner did not agree
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(panel.hasAttribute("hidden")).toBe(true)
    expect(trigger.getAttribute("aria-expanded")).toBe("false")

    rerender(<Basic open onOpenChange={onOpenChange} />)
    expect(panel.hasAttribute("hidden")).toBe(false)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")

    fireEvent.click(trigger)
    expect(onOpenChange).toHaveBeenLastCalledWith(false)
    expect(panel.hasAttribute("hidden")).toBe(false)
  })

  it("does nothing from a disabled trigger", () => {
    const onOpenChange = vi.fn()
    const { container } = render(
      <Basic disabled onOpenChange={onOpenChange} />,
    )
    const { trigger, panel } = parts(container)
    expect(trigger.disabled).toBe(true)
    fireEvent.click(trigger)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(panel.hasAttribute("hidden")).toBe(true)
  })

  it("lets the trigger's own onClick cancel the toggle", () => {
    const { container } = render(
      <Collapsible>
        <Collapsible.Trigger onClick={(e) => e.preventDefault()}>
          Details
        </Collapsible.Trigger>
        <Collapsible.Panel>Body</Collapsible.Panel>
      </Collapsible>,
    )
    const { trigger, panel } = parts(container)
    fireEvent.click(trigger)
    expect(panel.hasAttribute("hidden")).toBe(true)
  })

  it("throws from useCollapsible outside a <Collapsible>", () => {
    function Outside() {
      useCollapsible()
      return null
    }
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(() => render(<Outside />)).toThrow(
      "useCollapsible must be used within <Collapsible>.",
    )
    error.mockRestore()
  })

  it("drives the panel from useCollapsible", () => {
    function Custom() {
      const { isOpen, isDisabled, toggle } = useCollapsible()
      return (
        <button type="button" data-custom onClick={toggle}>
          {isOpen ? "open" : "closed"}
          {isDisabled ? " disabled" : ""}
        </button>
      )
    }
    const { container } = render(
      <Collapsible>
        <Custom />
        <Collapsible.Panel>Body</Collapsible.Panel>
      </Collapsible>,
    )
    const custom =
      container.querySelector<HTMLButtonElement>("[data-custom]")
    const panel = container.querySelector<HTMLElement>(
      '[data-adaptv="collapsible-panel"]',
    )
    if (!custom || !panel) throw new Error("parts missing")
    expect(custom.textContent).toBe("closed")
    fireEvent.click(custom)
    expect(custom.textContent).toBe("open")
    expect(panel.hasAttribute("hidden")).toBe(false)
  })
})

describe("Collapsible — aria wiring", () => {
  it("links trigger and panel by generated ids", () => {
    const { container } = render(<Basic />)
    const { trigger, panel } = parts(container)
    expect(trigger.id).not.toBe("")
    expect(panel.id).not.toBe("")
    expect(trigger.getAttribute("aria-controls")).toBe(panel.id)
    expect(panel.getAttribute("aria-labelledby")).toBe(trigger.id)
    expect(panel.getAttribute("role")).toBe("region")
    expect(trigger.getAttribute("type")).toBe("button")
  })

  it("follows a consumer id on either part", () => {
    const { container } = render(
      <Collapsible>
        <Collapsible.Trigger id="faq-q1">Q</Collapsible.Trigger>
        <Collapsible.Panel id="faq-a1">A</Collapsible.Panel>
      </Collapsible>,
    )
    const { trigger, panel } = parts(container)
    expect(trigger.id).toBe("faq-q1")
    expect(panel.id).toBe("faq-a1")
    expect(trigger.getAttribute("aria-controls")).toBe("faq-a1")
    expect(panel.getAttribute("aria-labelledby")).toBe("faq-q1")
  })
})

describe("Collapsible — hidden until found", () => {
  //React 19.2 renders the prop as a bare `hidden`; the value that keeps the content
  //in find-in-page only exists once the layout effect has run.
  it("upgrades the closed panel to hidden=until-found after mount", () => {
    const { container } = render(<Basic />)
    const { panel } = parts(container)
    expect(panel.getAttribute("hidden")).toBe("until-found")
  })

  it("puts until-found back after a close", () => {
    const { container } = render(<Basic defaultOpen />)
    const { trigger, panel } = parts(container)
    fireEvent.click(trigger)
    expect(panel.getAttribute("hidden")).toBe("until-found")
  })

  it("opens on beforematch and tells the owner", () => {
    const onOpenChange = vi.fn()
    const { container } = render(<Basic onOpenChange={onOpenChange} />)
    const { trigger, panel } = parts(container)
    act(() => {
      //the browser removes the attribute itself, then scrolls to the match
      panel.removeAttribute("hidden")
      panel.dispatchEvent(new Event("beforematch"))
    })
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(panel.hasAttribute("data-collapsible-open")).toBe(true)
    expect(trigger.getAttribute("aria-expanded")).toBe("true")
    expect(panel.hasAttribute("hidden")).toBe(false)
    //instant: the scroll target must not move under the browser
    expect(phase(panel)).toBeNull()
    expect(panel.style.height).toBe("")
  })

  it("restores hidden when a controlled owner refuses the match", () => {
    const onOpenChange = vi.fn()
    const { container } = render(
      <Basic open={false} onOpenChange={onOpenChange} />,
    )
    const { panel } = parts(container)
    act(() => {
      panel.removeAttribute("hidden")
      panel.dispatchEvent(new Event("beforematch"))
    })
    expect(onOpenChange).toHaveBeenCalledWith(true)
    expect(panel.getAttribute("hidden")).toBe("until-found")
    expect(panel.hasAttribute("data-collapsible-open")).toBe(false)
  })
})

describe("Collapsible — height transition", () => {
  it("settles synchronously when no transition runs (happy-dom has no getAnimations)", () => {
    const { container } = render(<Basic />)
    const { trigger, panel } = parts(container)
    expect(typeof panel.getAnimations).toBe("undefined")

    fireEvent.click(trigger)
    expect(panel.hasAttribute("data-collapsible-open")).toBe(true)
    expect(phase(panel)).toBeNull()
    expect(panel.style.height).toBe("")
    expect(panel.hasAttribute("hidden")).toBe(false)

    fireEvent.click(trigger)
    expect(panel.hasAttribute("data-collapsible-open")).toBe(false)
    expect(phase(panel)).toBeNull()
    expect(panel.style.height).toBe("")
    expect(panel.getAttribute("hidden")).toBe("until-found")
  })

  it("holds the open phase and the measured height until the transition ends", () => {
    const { container } = render(<Basic />)
    const { trigger, panel } = parts(container)
    const running = { value: true }
    fakeHeightTransition(panel, running)
    Object.defineProperty(panel, "scrollHeight", {
      configurable: true,
      value: 120,
    })

    fireEvent.click(trigger)
    expect(panel.hasAttribute("hidden")).toBe(false)
    expect(phase(panel)).toBe("opening")
    expect(panel.style.height).toBe("120px")

    //an end for some OTHER property, or from a descendant, is not ours
    act(() => {
      panel.dispatchEvent(transitionEvent("transitionend", "opacity"))
    })
    expect(phase(panel)).toBe("opening")
    const child = panel.firstElementChild as HTMLElement
    act(() => {
      child.dispatchEvent(transitionEvent("transitionend", "height"))
    })
    expect(phase(panel)).toBe("opening")

    running.value = false
    act(() => {
      panel.dispatchEvent(transitionEvent("transitionend", "height"))
    })
    expect(phase(panel)).toBeNull()
    expect(panel.style.height).toBe("")
    expect(panel.hasAttribute("data-collapsible-open")).toBe(true)
  })

  it("keeps the panel displayed through the close and hides it only on settle", () => {
    const { container } = render(<Basic defaultOpen />)
    const { trigger, panel } = parts(container)
    const running = { value: true }
    fakeHeightTransition(panel, running)

    fireEvent.click(trigger)
    expect(panel.hasAttribute("data-collapsible-open")).toBe(false)
    expect(phase(panel)).toBe("closing")
    expect(panel.hasAttribute("hidden")).toBe(false)
    expect(panel.style.height).toBe("0px")

    running.value = false
    act(() => {
      panel.dispatchEvent(transitionEvent("transitionend", "height"))
    })
    expect(phase(panel)).toBeNull()
    expect(panel.style.height).toBe("")
    expect(panel.getAttribute("hidden")).toBe("until-found")
  })

  //A retarget cancels the previous transition, and that `transitioncancel` is
  //dispatched a frame later, after the new one is already running. Settling on
  //it would hide a panel that is still animating open.
  it("ignores the cancel of a retargeted transition while the new one runs", () => {
    const { container } = render(<Basic />)
    const { trigger, panel } = parts(container)
    const running = { value: true }
    fakeHeightTransition(panel, running)
    Object.defineProperty(panel, "scrollHeight", {
      configurable: true,
      value: 80,
    })

    fireEvent.click(trigger)
    expect(phase(panel)).toBe("opening")
    fireEvent.click(trigger)
    expect(phase(panel)).toBe("closing")
    expect(panel.style.height).toBe("0px")
    fireEvent.click(trigger)
    expect(phase(panel)).toBe("opening")
    //mid-flight: only the target is written, never a snap back to 0
    expect(panel.style.height).toBe("80px")

    act(() => {
      panel.dispatchEvent(transitionEvent("transitioncancel", "height"))
    })
    expect(phase(panel)).toBe("opening")
    expect(panel.hasAttribute("hidden")).toBe(false)

    running.value = false
    act(() => {
      panel.dispatchEvent(transitionEvent("transitionend", "height"))
    })
    expect(phase(panel)).toBeNull()
    expect(panel.style.height).toBe("")
    expect(panel.hasAttribute("data-collapsible-open")).toBe(true)
    expect(panel.hasAttribute("hidden")).toBe(false)
  })

  it("collapses the phases to one commit under prefers-reduced-motion", () => {
    const matchMedia = (query: string) =>
      ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList
    vi.stubGlobal("matchMedia", matchMedia)
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: matchMedia,
    })

    const { container } = render(<Basic />)
    const { trigger, panel } = parts(container)
    //a transition WOULD run here; the React side must not wait for it
    fakeHeightTransition(panel, { value: true })

    fireEvent.click(trigger)
    expect(panel.hasAttribute("data-collapsible-open")).toBe(true)
    expect(phase(panel)).toBeNull()
    expect(panel.style.height).toBe("")
    expect(panel.hasAttribute("hidden")).toBe(false)

    fireEvent.click(trigger)
    expect(phase(panel)).toBeNull()
    expect(panel.style.height).toBe("")
    expect(panel.getAttribute("hidden")).toBe("until-found")
  })

  it("does not tear down the panel when the owner re-renders mid-transition", () => {
    function Owner() {
      const [n, setN] = useState(0)
      return (
        <Collapsible>
          <Collapsible.Trigger>Details</Collapsible.Trigger>
          <button type="button" data-bump onClick={() => setN(n + 1)}>
            {n}
          </button>
          <Collapsible.Panel>Body</Collapsible.Panel>
        </Collapsible>
      )
    }
    const { container } = render(<Owner />)
    const { trigger, panel } = parts(container)
    const running = { value: true }
    fakeHeightTransition(panel, running)
    Object.defineProperty(panel, "scrollHeight", {
      configurable: true,
      value: 50,
    })
    fireEvent.click(trigger)
    expect(panel.style.height).toBe("50px")

    const bump = container.querySelector<HTMLButtonElement>("[data-bump]")
    if (!bump) throw new Error("bump missing")
    fireEvent.click(bump)
    //an unrelated commit leaves the running phase alone
    expect(phase(panel)).toBe("opening")
    expect(panel.style.height).toBe("50px")
  })
})
