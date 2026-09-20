import { LocalNotifications } from "@capacitor/local-notifications"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cancelNotification,
  checkNotifyPermission,
  getNotifyCaveat,
  listScheduledNotifications,
  notify,
  onNotificationOpened,
  requestNotifyPermission,
  scheduleNotification,
} from "#adaptv/capabilities/notifications"
import {
  NOTIFICATION_OPENED,
  NOTIFICATION_OPENED_QUERY,
} from "#adaptv/sw/sw.notification-protocol"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isIOS, isNativePlatform } from "#adaptv/utils/platform"

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(async () => ({ display: "granted" })),
    requestPermissions: vi.fn(async () => ({ display: "granted" })),
    schedule: vi.fn(async () => ({ notifications: [] })),
    getPending: vi.fn(async () => ({ notifications: [] })),
    cancel: vi.fn(async () => {}),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => {}) })),
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
/** Everything the page posted to its worker, and the listener it registered. */
const worker = {
  posted: [] as unknown[],
  listeners: [] as Array<(event: MessageEvent) => void>,
  removed: 0,
}
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
  const active = {
    postMessage: (message: unknown) => worker.posted.push(message),
  }
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: vi.fn(async () =>
        hasRegistration
          ? { showNotification, getNotifications, active }
          : undefined,
      ),
      ready: Promise.resolve({ active }),
      addEventListener: (_type: string, fn: (e: MessageEvent) => void) =>
        worker.listeners.push(fn),
      removeEventListener: () => {
        worker.removed += 1
      },
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
  worker.posted = []
  worker.listeners = []
  worker.removed = 0
  vi.mocked(LocalNotifications.addListener).mockResolvedValue({
    remove: vi.fn(async () => {}),
  } as never)
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
      data: { id: 7, data: {} },
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
    //never asked is not refused: the caller's next step is to ask, not to send
    //the user to settings
    expect(await notify({ title: "Done", body: "x" })).toBe("prompt")
    expect(showNotification).not.toHaveBeenCalled()
    expect(
      await scheduleNotification({
        title: "Later",
        body: "x",
        at: new Date(Date.now() + 60_000),
      }),
    ).toBe("unsupported")
    expect(await listScheduledNotifications()).toEqual([])
    const caveat = getNotifyCaveat()
    expect(caveat).toContain("service worker")
    //scheduling is unsupported here, so the caveat may not describe a
    //notification that "fires" later while the app happens to be open
    expect(caveat).toContain("unsupported")
    expect(caveat).not.toMatch(/fires/)
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
      data: { id: 8, data: {} },
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
      data: { id: 9, data: {} },
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

  it("a permission never asked for is prompt, not denied, on both paths", async () => {
    native()
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({
      display: "prompt",
    } as never)
    expect(await checkNotifyPermission()).toBe("prompt")
    expect(await notify({ title: "x", body: "y" })).toBe("prompt")
    expect(
      await scheduleNotification({
        title: "x",
        body: "y",
        at: new Date(),
      }),
    ).toBe("prompt")
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

describe("notifications — a tap comes back", () => {
  it("carries the payload into the web notification and back out of the worker's message", async () => {
    const seen: unknown[] = []
    const stop = onNotificationOpened((opened) => seen.push(opened))
    await notify({
      title: "Done",
      body: "Two saved",
      id: 7,
      data: { route: "/inbox" },
    })
    expect(showNotification).toHaveBeenCalledWith("Done", {
      body: "Two saved",
      tag: "7",
      data: { id: 7, data: { route: "/inbox" } },
    })

    for (const listener of worker.listeners)
      listener({
        data: {
          type: NOTIFICATION_OPENED,
          id: 7,
          data: { route: "/inbox" },
        },
      } as MessageEvent)
    expect(seen).toEqual([{ id: 7, data: { route: "/inbox" } }])

    stop()
    expect(worker.removed).toBe(1)
  })

  it("asks the worker for a tap that arrived before the page existed", async () => {
    const stop = onNotificationOpened(() => {})
    //the ready promise is what the subscription waits on
    await Promise.resolve()
    await Promise.resolve()
    expect(worker.posted).toEqual([{ type: NOTIFICATION_OPENED_QUERY }])
    stop()
  })

  it("ignores a message that is not a tap", async () => {
    const seen: unknown[] = []
    onNotificationOpened((opened) => seen.push(opened))
    for (const listener of worker.listeners)
      for (const data of [{ type: "push" }, { type: NOTIFICATION_OPENED }])
        listener({ data } as MessageEvent)
    expect(seen).toEqual([])
  })

  it("native subscribes to the plugin's own tap event and reads the extras", async () => {
    native()
    const seen: unknown[] = []
    onNotificationOpened((opened) => seen.push(opened))
    const [event, handler] = vi.mocked(LocalNotifications.addListener).mock
      .calls[0] as [string, (e: unknown) => void]
    expect(event).toBe("localNotificationActionPerformed")

    handler({
      actionId: "tap",
      notification: { id: 4, extra: { route: "/inbox", count: 3 } },
    })
    //a button on the notification is not the notification
    handler({
      actionId: "snooze",
      notification: { id: 4, extra: { route: "/later" } },
    })
    expect(seen).toEqual([{ id: 4, data: { route: "/inbox" } }])
    expect(worker.listeners).toEqual([])
  })

  it("native carries the payload as the plugin's extras, now and later", async () => {
    native()
    await notify({ title: "a", body: "b", id: 1, data: { route: "/x" } })
    expect(LocalNotifications.schedule).toHaveBeenCalledWith({
      notifications: [
        {
          id: 1,
          title: "a",
          body: "b",
          extra: { route: "/x" },
          isExactNotification: false,
        },
      ],
    })
    const at = new Date(Date.now() + 60_000)
    await scheduleNotification({
      title: "a",
      body: "b",
      id: 2,
      at,
      data: { route: "/y" },
    })
    expect(LocalNotifications.schedule).toHaveBeenLastCalledWith({
      notifications: [
        {
          id: 2,
          title: "a",
          body: "b",
          extra: { route: "/y" },
          schedule: { at },
          isExactNotification: false,
        },
      ],
    })
  })

  it("a binary built before the plugin subscribes to nothing and never throws", () => {
    native(false)
    vi.stubGlobal("navigator", {})
    expect(() => onNotificationOpened(() => {})()).not.toThrow()
    expect(LocalNotifications.addListener).not.toHaveBeenCalled()
  })
})
