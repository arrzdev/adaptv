import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cancelNotification,
  checkNotifyPermission,
  getNotifyCaveat,
  listScheduledNotifications,
  notify,
  scheduleNotification,
} from "#adaptv/capabilities/notifications"
import { useNotifications } from "#adaptv/hooks/use-notifications"

vi.mock("#adaptv/capabilities/notifications", () => ({
  checkNotifyPermission: vi.fn(async () => "prompt"),
  requestNotifyPermission: vi.fn(async () => "granted"),
  getNotifyCaveat: vi.fn(() => "a caveat"),
  notify: vi.fn(async () => "shown"),
  scheduleNotification: vi.fn(async () => "scheduled"),
  listScheduledNotifications: vi.fn(async () => []),
  cancelNotification: vi.fn(async () => {}),
}))

beforeEach(() => {
  vi.mocked(checkNotifyPermission).mockResolvedValue("prompt" as never)
  vi.mocked(listScheduledNotifications).mockResolvedValue([])
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("useNotifications", () => {
  it("reads the permission, the caveat and the pending list once, after the first effect", async () => {
    const { result } = renderHook(() => useNotifications())
    expect(result.current.permission).toBeNull()
    await waitFor(() => expect(result.current.permission).toBe("prompt"))
    expect(result.current.caveat).toBe("a caveat")
    expect(result.current.pending).toEqual([])
    expect(checkNotifyPermission).toHaveBeenCalledTimes(1)
  })

  it("asking updates the permission the row renders", async () => {
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(result.current.permission).toBe("prompt"))
    await act(async () => {
      await expect(result.current.request()).resolves.toBe("granted")
    })
    expect(result.current.permission).toBe("granted")
    expect(getNotifyCaveat).toHaveBeenCalledTimes(2)
  })

  it("scheduling refreshes the pending list, and cancelling refreshes it again", async () => {
    const scheduled = [
      {
        id: 4,
        title: "Later",
        body: "x",
        at: new Date("2026-09-02T20:00:00Z"),
      },
    ]
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(result.current.permission).toBe("prompt"))
    vi.mocked(listScheduledNotifications).mockResolvedValue(scheduled)
    await act(async () => {
      await expect(
        result.current.schedule({
          title: "Later",
          body: "x",
          at: scheduled[0].at,
        }),
      ).resolves.toBe("scheduled")
    })
    expect(result.current.pending).toEqual(scheduled)
    expect(scheduleNotification).toHaveBeenCalledTimes(1)

    vi.mocked(listScheduledNotifications).mockResolvedValue([])
    await act(async () => {
      await result.current.cancel(4)
    })
    expect(cancelNotification).toHaveBeenCalledWith(4)
    expect(result.current.pending).toEqual([])
  })

  it("showing one re-reads the permission, because the browser may have changed it", async () => {
    const { result } = renderHook(() => useNotifications())
    await waitFor(() => expect(result.current.permission).toBe("prompt"))
    vi.mocked(checkNotifyPermission).mockResolvedValue("denied" as never)
    await act(async () => {
      await expect(
        result.current.notify({ title: "Done", body: "x" }),
      ).resolves.toBe("shown")
    })
    expect(notify).toHaveBeenCalledWith({ title: "Done", body: "x" })
    expect(result.current.permission).toBe("denied")
  })
})
