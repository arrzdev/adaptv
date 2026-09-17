import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { OpenedNotification } from "#adaptv/capabilities/notifications"
import { onNotificationOpened } from "#adaptv/capabilities/notifications"
import { useNotificationOpened } from "#adaptv/hooks/use-notification-opened"

const stop = vi.fn()
let handler: ((opened: OpenedNotification) => void) | null = null

vi.mock("#adaptv/capabilities/notifications", () => ({
  onNotificationOpened: vi.fn((fn: (o: OpenedNotification) => void) => {
    handler = fn
    return stop
  }),
}))

afterEach(() => {
  handler = null
  vi.clearAllMocks()
})

describe("useNotificationOpened", () => {
  it("subscribes once and runs the latest callback", () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(
      ({ fn }: { fn: () => void }) => useNotificationOpened(fn),
      { initialProps: { fn: first } },
    )
    //an inline arrow is the normal way to call this: a re-subscribe on every
    //render would re-ask the worker for the held tap each time
    rerender({ fn: second })
    expect(onNotificationOpened).toHaveBeenCalledTimes(1)

    handler?.({ id: 3, data: { route: "/inbox" } })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith({
      id: 3,
      data: { route: "/inbox" },
    })
  })

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() => useNotificationOpened(() => {}))
    //strict mode already mounted, cleaned up and mounted again, so the count
    //before the unmount is the interesting baseline, not zero
    const before = stop.mock.calls.length
    unmount()
    expect(stop.mock.calls.length).toBe(before + 1)
  })
})
