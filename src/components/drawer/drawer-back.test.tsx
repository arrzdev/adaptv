import { act, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BackPriority,
  registerBackHandler,
  resetBackChain,
  runBackChain,
} from "#adaptv/capabilities/back-chain"
import { Drawer } from "#adaptv/components/drawer"

/**
 * The back chain's floor, standing in for the router handler that
 * `useAndroidBackButton` registers at the bottom of the chain. If a press
 * reaches this while a drawer is open, the route moved out from under the
 * drawer — which is the bug these tests exist to catch.
 */
function installRouterFloor() {
  const floor = vi.fn(() => true)
  registerBackHandler(floor, BackPriority.RouterBack)
  return floor
}

function Sheet({
  open,
  onOpenChange,
}: {
  open?: boolean
  onOpenChange?: (next: boolean) => void
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Content>body</Drawer.Content>
      </Drawer.Portal>
    </Drawer>
  )
}

afterEach(() => {
  resetBackChain()
})

describe("Drawer and the back chain", () => {
  it("consumes the back press while open, and the router floor never sees it", () => {
    const floor = installRouterFloor()
    const onOpenChange = vi.fn()
    render(<Sheet open onOpenChange={onOpenChange} />)

    let consumed = false
    act(() => {
      consumed = runBackChain()
    })

    expect(consumed).toBe(true)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(floor).not.toHaveBeenCalled()
  })

  it("defers while closed, so back still navigates", () => {
    const floor = installRouterFloor()
    const onOpenChange = vi.fn()
    render(<Sheet open={false} onOpenChange={onOpenChange} />)

    act(() => {
      runBackChain()
    })

    expect(floor).toHaveBeenCalledTimes(1)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it("stops intercepting once it unmounts", () => {
    const floor = installRouterFloor()
    const { unmount } = render(<Sheet open />)
    unmount()

    act(() => {
      runBackChain()
    })

    expect(floor).toHaveBeenCalledTimes(1)
  })

  it("closes one drawer per press, innermost first", () => {
    const floor = installRouterFloor()
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <Drawer open onOpenChange={outer}>
        <Drawer.Portal>
          <Drawer.Content>
            <Drawer.Nested open onOpenChange={inner}>
              <Drawer.Portal>
                <Drawer.Content>inner</Drawer.Content>
              </Drawer.Portal>
            </Drawer.Nested>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer>,
    )

    act(() => {
      runBackChain()
    })

    expect(inner).toHaveBeenCalledWith(false)
    expect(outer).not.toHaveBeenCalledWith(false)
    expect(floor).not.toHaveBeenCalled()
  })
})
