import { act, render } from "@testing-library/react"
import { useState } from "react"
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

  it("closes the drawer opened last first, whatever order the tree mounts them in", () => {
    //Two sibling drawers, the SECOND in the tree opened first and the first
    //opened on top of it. Registering at mount ordered them by tree position,
    //so back closed the sheet underneath and left the top one standing.
    const floor = installRouterFloor()
    const closedTop = vi.fn()
    const closedUnder = vi.fn()
    let openTop = () => {}
    let openUnder = () => {}
    function Page() {
      const [top, setTop] = useState(false)
      const [under, setUnder] = useState(false)
      openTop = () => setTop(true)
      openUnder = () => setUnder(true)
      return (
        <>
          <Drawer
            open={top}
            onOpenChange={(next) => {
              if (!next) closedTop()
              setTop(next)
            }}
          >
            <Drawer.Portal>
              <Drawer.Content>top</Drawer.Content>
            </Drawer.Portal>
          </Drawer>
          <Drawer
            open={under}
            onOpenChange={(next) => {
              if (!next) closedUnder()
              setUnder(next)
            }}
          >
            <Drawer.Portal>
              <Drawer.Content>under</Drawer.Content>
            </Drawer.Portal>
          </Drawer>
        </>
      )
    }
    render(<Page />)
    act(() => openUnder())
    act(() => openTop())

    act(() => {
      runBackChain()
    })
    expect(closedTop).toHaveBeenCalledTimes(1)
    expect(closedUnder).not.toHaveBeenCalled()

    act(() => {
      runBackChain()
    })
    expect(closedUnder).toHaveBeenCalledTimes(1)
    expect(floor).not.toHaveBeenCalled()
  })
})
