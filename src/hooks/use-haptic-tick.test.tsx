import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { HAPTIC_TICK_ATTR } from "#adaptv/capabilities/haptic-tick"
import { useHapticTick } from "#adaptv/hooks/use-haptic-tick"

const restores: Array<() => void> = []

function stubNavigatorProp(key: string, value: unknown): void {
  const prev = Object.getOwnPropertyDescriptor(navigator, key)
  Object.defineProperty(navigator, key, { value, configurable: true })
  restores.push(() => {
    if (prev) Object.defineProperty(navigator, key, prev)
    else delete (navigator as unknown as Record<string, unknown>)[key]
  })
}

function forceIOSWeb(): void {
  vi.stubGlobal("Capacitor", undefined)
  stubNavigatorProp(
    "userAgent",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5)",
  )
  stubNavigatorProp("vibrate", undefined)
}

afterEach(() => {
  for (const r of restores.splice(0)) r()
  vi.unstubAllGlobals()
})

function Tappable({ enabled = true }: { enabled?: boolean }) {
  const ref = useHapticTick(enabled)
  return (
    <button type="button" ref={ref}>
      tap
    </button>
  )
}

function overlay(container: HTMLElement) {
  return container.querySelector(`[${HAPTIC_TICK_ATTR}]`)
}

describe("useHapticTick", () => {
  it("attaches the transducer to the ref'd element", () => {
    forceIOSWeb()
    const { container } = render(<Tappable />)
    expect(overlay(container)).not.toBeNull()
  })

  it("detaches on unmount — no orphan nodes", () => {
    forceIOSWeb()
    const { container, unmount } = render(<Tappable />)
    expect(overlay(container)).not.toBeNull()

    //scoped to this render's container, not `document`: there is no RTL
    //auto-cleanup configured in this project, so earlier tests' trees are still
    //mounted and a document-wide query would find their overlays instead
    unmount()
    expect(overlay(container)).toBeNull()
  })

  it("removes the transducer when disabled, and restores it when re-enabled", () => {
    //a Button whose `haptic` prop flips must not leak a dead overlay
    forceIOSWeb()
    const { container, rerender } = render(<Tappable enabled />)
    expect(overlay(container)).not.toBeNull()

    rerender(<Tappable enabled={false} />)
    expect(overlay(container)).toBeNull()

    rerender(<Tappable enabled />)
    expect(overlay(container)).not.toBeNull()
  })

  it("costs nothing where a real haptic engine exists", () => {
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true })
    const { container } = render(<Tappable />)
    expect(overlay(container)).toBeNull()
  })
})
