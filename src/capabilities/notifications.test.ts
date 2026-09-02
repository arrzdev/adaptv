import { LocalNotifications } from "@capacitor/local-notifications"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cancelNotification,
  checkNotifyPermission,
  getNotifyCaveat,
  listScheduledNotifications,
  notify,
  requestNotifyPermission,
  scheduleNotification,
} from "#adaptv/capabilities/notifications"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isIOS, isNativePlatform } from "#adaptv/utils/platform"

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(async () => ({ display: "granted" })),
    requestPermissions: vi.fn(async () => ({ display: "granted" })),
    schedule: vi.fn(async () => ({ notifications: [] })),
    getPending: vi.fn(async () => ({ notifications: [] })),
    cancel: vi.fn(async () => {}),
  },
}))
vi.mock("#adaptv/utils/platform", () => ({
  isNativePlatform: vi.fn(() => false),
  isIOS: vi.fn(() => false),
}))
vi.mock("#adaptv/utils/native-plugins", () => ({
  hasNativePlugin: vi.fn(() => true),
}))

const showNotification = vi.fn(async () => {})
const close = vi.fn()
const getNotifications = vi.fn(async () => [{ close }])
let hasRegistration = true

function web(
  permission: NotificationPermission = "granted",
  query?: string,
) {
  vi.stubGlobal("Notification", {
    permission,
    requestPermission: vi.fn(async () => permission),
  })
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: vi.fn(async () =>
        hasRegistration
          ? { showNotification, getNotifications, active: {} }
          : undefined,
      ),
    },
    //Only present when a test wants the Permissions API in play; the others
    //exercise the constructor fallback an older Safari leaves behind.
    permissions: query
      ? { query: vi.fn(async () => ({ state: query })) }
      : undefined,
  })
}

function native(plugin = true) {
  vi.mocked(isNativePlatform).mockReturnValue(true)
  vi.mocked(hasNativePlugin).mockReturnValue(plugin)
}

beforeEach(() => {
  //`clearAllMocks` forgets calls, not implementations: without this a rejected
  //`checkPermissions` from one test would silently disarm the next one's.
  vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({
    display: "granted",
  } as never)
  vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({
    display: "granted",
  } as never)
  vi.mocked(LocalNotifications.getPending).mockResolvedValue({
    notifications: [],
  })
  hasRegistration = true
  vi.mocked(isNativePlatform).mockReturnValue(false)
  vi.mocked(isIOS).mockReturnValue(false)
  vi.mocked(hasNativePlugin).mockReturnValue(true)
  web()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("notifications — the web", () => {
  it("shows through the service worker registration, tagged by id, never through the Notification constructor", async () => {
    expect(await checkNotifyPermission()).toBe("granted")
    expect(await notify({ title: "Done", body: "Two saved", id: 7 })).toBe(
      "shown",
    )
    expect(showNotification).toHaveBeenCalledWith("Done", {
      body: "Two saved",
      tag: "7",
    })
    expect(LocalNotifications.schedule).not.toHaveBeenCalled()
  })

  it("granted with no registered worker is unavailable, not granted", async () => {
    hasRegistration = false
    expect(await checkNotifyPermission()).toBe("unavailable")
    expect(await notify({ title: "Done", body: "x" })).toBe("unavailable")
    expect(showNotification).not.toHaveBeenCalled()
  })

  it("a denied browser is denied, and asking returns what the user said", async () => {
    web("denied")
    expect(await checkNotifyPermission()).toBe("denied")
    expect(await notify({ title: "Done", body: "x" })).toBe("denied")
    expect(await requestNotifyPermission()).toBe("denied")
  })

  it("default reads prompt, and cannot schedule for later at all", async () => {
    web("default")
    expect(await checkNotifyPermission()).toBe("prompt")
    expect(
      await scheduleNotification({
        title: "Later",
        body: "x",
        at: new Date(Date.now() + 60_000),
      }),
    ).toBe("unsupported")
    expect(await listScheduledNotifications()).toEqual([])
    expect(getNotifyCaveat()).toContain("service worker")
  })

  it("cancel closes the open banner with that tag", async () => {
    await cancelNotification(7)
    expect(getNotifications).toHaveBeenCalledWith({ tag: "7" })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("the Permissions API wins over the constructor, which disagrees under automation", async () => {
    //Measured with Playwright: a granted Chromium reports denied on
    //`Notification.permission` and granted on the query; a granted WebKit
    //reports default. Reading the constructor would refuse to show anything.
    web("denied", "granted")
    expect(await checkNotifyPermission()).toBe("granted")
    expect(await notify({ title: "Done", body: "x", id: 8 })).toBe("shown")
    expect(showNotification).toHaveBeenCalledWith("Done", {
      body: "x",
      tag: "8",
    })
    web("granted", "denied")
    expect(await checkNotifyPermission()).toBe("denied")
  })

  it("a query that does not know the name falls back to the constructor", async () => {
    vi.stubGlobal("Notification", { permission: "granted" })
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(async () => ({
          showNotification,
          getNotifications,
          active: {},
        })),
      },
      permissions: {
        query: vi.fn(async () => {
          throw new TypeError("unknown permission name")
        }),
      },
    })
    expect(await checkNotifyPermission()).toBe("granted")
  })

  it("a still-installing worker is granted to read and waited for to show", async () => {
    //Chromium rejects `showNotification` with "No active registration
    //available" while the worker is installing, so a registration alone is not
    //an answer.
    const activated = { showNotification, getNotifications, active: {} }
    vi.stubGlobal("Notification", { permission: "granted" })
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(async () => ({
          showNotification,
          getNotifications,
          active: null,
        })),
        ready: Promise.resolve(activated),
      },
      permissions: { query: vi.fn(async () => ({ state: "granted" })) },
    })
    //Reading takes the registration as it is; showing waits for `ready`, whose
    //registration is the one that carries the notification.
    expect(await checkNotifyPermission()).toBe("granted")
    expect(await notify({ title: "Done", body: "x", id: 9 })).toBe("shown")
    expect(showNotification).toHaveBeenCalledWith("Done", {
      body: "x",
      tag: "9",
    })
    expect(activated.active).toBeTruthy()
  })

  it("a page with no service worker API is unavailable", async () => {
    vi.stubGlobal("navigator", {})
    expect(await checkNotifyPermission()).toBe("unavailable")
    expect(await requestNotifyPermission()).toBe("unavailable")
  })
})

describe("notifications — native", () => {
  it("shows through the plugin and schedules with the OS's own alarm", async () => {
    native()
    expect(await notify({ title: "Done", body: "Two saved", id: 3 })).toBe(
      "shown",
    )
    expect(LocalNotifications.schedule).toHaveBeenCalledWith({
      notifications: [
        {
          id: 3,
          title: "Done",
          body: "Two saved",
          isExactNotification: false,
        },
      ],
    })
    const at = new Date(Date.now() + 60_000)
    expect(
      await scheduleNotification({ title: "Later", body: "x", at, id: 4 }),
    ).toBe("scheduled")
    expect(LocalNotifications.schedule).toHaveBeenLastCalledWith({
      notifications: [
        {
          id: 4,
          title: "Later",
          body: "x",
          schedule: { at },
          isExactNotification: false,
        },
      ],
    })
    expect(showNotification).not.toHaveBeenCalled()
  })

  it("lists only what is still to come, as dates, and cancels by id", async () => {
    native()
    const soon = new Date(Date.now() + 60_000)
    const gone = new Date(Date.now() - 60_000)
    vi.mocked(LocalNotifications.getPending).mockResolvedValue({
      notifications: [
        { id: 4, title: "Later", body: "x", schedule: { at: soon } },
        //Delivered, and kept forever by the plugin's own store.
        { id: 5, title: "Fired", body: "y", schedule: { at: gone } },
        //A repeat has a next time even though its first one has passed.
        {
          id: 6,
          title: "Daily",
          body: "z",
          schedule: { at: gone, repeats: true },
        },
        //An immediate one, never scheduled at all.
        { id: 7, title: "Now", body: "w" },
      ],
    } as never)
    const pending = await listScheduledNotifications()
    expect(pending).toEqual([
      { id: 4, title: "Later", body: "x", at: soon },
      { id: 6, title: "Daily", body: "z", at: gone },
    ])
    await cancelNotification(4)
    expect(LocalNotifications.cancel).toHaveBeenCalledWith({
      notifications: [{ id: 4 }],
    })
  })

  it("a permission the user refused is denied, and the schedule is refused with it", async () => {
    native()
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({
      display: "denied",
    } as never)
    expect(await checkNotifyPermission()).toBe("denied")
    expect(await notify({ title: "x", body: "y" })).toBe("denied")
    expect(
      await scheduleNotification({
        title: "x",
        body: "y",
        at: new Date(),
      }),
    ).toBe("denied")
    expect(LocalNotifications.schedule).not.toHaveBeenCalled()
  })

  it("a plugin that rejects is unavailable, and asking says so too", async () => {
    native()
    vi.mocked(LocalNotifications.checkPermissions).mockRejectedValue(
      new Error("bridge"),
    )
    vi.mocked(LocalNotifications.requestPermissions).mockRejectedValue(
      new Error("bridge"),
    )
    expect(await checkNotifyPermission()).toBe("unavailable")
    expect(await requestNotifyPermission()).toBe("unavailable")
    expect(await notify({ title: "x", body: "y" })).toBe("unavailable")
  })

  it("a binary built before the plugin is unavailable and says why, and cannot schedule", async () => {
    native(false)
    expect(await checkNotifyPermission()).toBe("unavailable")
    expect(getNotifyCaveat()).toContain("built before")
    expect(
      await scheduleNotification({
        title: "x",
        body: "y",
        at: new Date(),
      }),
    ).toBe("unsupported")
    expect(LocalNotifications.checkPermissions).not.toHaveBeenCalled()
  })

  it("iOS withholds nothing, Android names the inexact alarm", async () => {
    native()
    vi.mocked(isIOS).mockReturnValue(true)
    expect(getNotifyCaveat()).toBeNull()
    vi.mocked(isIOS).mockReturnValue(false)
    expect(getNotifyCaveat()).toContain("inexact alarm")
  })

  //The plugin opens the system "Alarms & reminders" screen for ANY schedule call
  //whose notification wants an exact alarm, immediate ones included. Nothing here
  //may ever ask for one.
  it("never asks for an exact alarm, on either path", async () => {
    native()
    await notify({ title: "x", body: "y" })
    await scheduleNotification({ title: "x", body: "y", at: new Date() })
    const calls = vi.mocked(LocalNotifications.schedule).mock.calls
    expect(calls).toHaveLength(2)
    for (const call of calls) {
      for (const n of call[0].notifications) {
        expect(n.isExactNotification).toBe(false)
      }
    }
  })
})
