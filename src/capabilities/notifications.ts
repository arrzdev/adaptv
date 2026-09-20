//Local notifications — a banner the app itself asks for, now or at a time.
//
//"Local" is the whole scope: no server, no credentials, no token registry. Push
//is a sibling with its own story and is deliberately not here.
//
//  • native → @capacitor/local-notifications, guarded by the plugin header, so a
//            binary built before the plugin says `unavailable` instead of throwing.
//            Scheduling is the OS's own alarm: it fires with the app closed.
//  • web    → the page's service worker registration and `showNotification`.
//            NOT `new Notification(...)`: Chrome on Android refuses it outright
//            and iOS has never supported it, while the worker path is the one
//            every engine implements and the only one that survives the page
//            going away. No browser ships notification triggers, so the web can
//            show one NOW and cannot schedule one for later — the API says so
//            with a separate word rather than a timer that lies.
//
//## The exact-alarm trap, absorbed
//
//The plugin's Android side asks for an exact alarm by default, and on API 31+
//an app that has not been allowed one is thrown OUT of itself into the system
//"Alarms & reminders" settings screen — for every `schedule()` call, including
//a notification meant to appear right now. Measured on the Pixel emulator: one
//press of "show one now" left the app and opened that screen, and the pending
//bridge call never resolved. adaptv sends `isExactNotification: false` on both
//paths instead. The cost is that a scheduled one can arrive a little late while
//the device is dozing; the alternative is a reminder that ejects the user into
//Settings, which is not a trade any app would choose on its own.
//
//The permission is the four-state shape geolocation set for every gated
//capability here: `unavailable` is not a permission, it is "asking cannot help",
//and it is what a browser without a registered worker, a private-mode Safari or
//a pre-plugin binary reports.
import { LocalNotifications } from "@capacitor/local-notifications"
import { hasNativePlugin } from "#adaptv/utils/native-plugins"
import { isIOS, isNativePlatform } from "#adaptv/utils/platform"

/**
 * Deliberately not the DOM's `NotificationPermission`, which has three states
 * and no word for "there is nothing to ask".
 */
export type NotifyPermission =
  | "granted"
  | "denied"
  | "prompt"
  | "unavailable"

/**
 * `"shown"` — handed to the OS or the worker. `"prompt"` and `"denied"` are the
 * permission's own words, kept apart: `"prompt"` was never asked, so the next
 * step is `requestNotifyPermission()`; `"denied"` was refused, so asking again
 * cannot help and only the app's settings can.
 */
export type NotifyOutcome = "shown" | "prompt" | "denied" | "unavailable"

/**
 * `"unsupported"` — the target cannot schedule at all; the web, today, cannot.
 * `"prompt"` and `"denied"` mean what they mean on {@link NotifyOutcome}.
 */
export type ScheduleOutcome =
  | "scheduled"
  | "prompt"
  | "denied"
  | "unsupported"

export interface NotifyOptions {
  title: string
  body: string
  /** Stable id, so a later `cancelNotification` can name it. Defaults to a fresh one. */
  id?: number
}

export interface ScheduleOptions extends NotifyOptions {
  /** When it should fire. In the past is the OS's problem, not ours: it fires at once. */
  at: Date
}

export interface ScheduledNotification {
  id: number
  title: string
  body: string
  at: Date | null
}

function nativePlugin(): boolean {
  return isNativePlatform() && hasNativePlugin("LocalNotifications")
}

function freshId(): number {
  //The plugin's Android side stores the id in an int, so keep it in range.
  return Math.floor(Math.random() * 2_000_000_000) + 1
}

function normalize(state: string): NotifyPermission {
  if (state === "granted") return "granted"
  if (state === "denied") return "denied"
  return "prompt"
}

//A worker that is installing usually takes over in well under a second; the
//bound is what keeps a page that never activates one from hanging a caller.
const ACTIVATION_GRACE_MS = 10_000

/**
 * The worker that could carry a notification, or `null`.
 *
 * `getRegistration` rather than `ready`, which never settles when no worker is
 * registered and would hang the caller for the whole session.
 *
 * `waitForActive` is the difference between reading a state and doing
 * something. Reading takes the registration as it is: a page one moment into
 * its first load has one that is still installing, and calling that
 * `unavailable` would make the row flicker for a permission that is genuinely
 * granted. Showing cannot: Chromium rejects with "No active registration
 * available on the ServiceWorkerRegistration" (measured against the built app,
 * a fresh browser context, one moment after load), so the show waits for the
 * worker to take over first.
 */
async function registration(
  waitForActive = false,
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !navigator.serviceWorker)
    return null
  try {
    const existing = await navigator.serviceWorker.getRegistration()
    if (!existing) return null
    if (existing.active || !waitForActive) return existing
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ACTIVATION_GRACE_MS),
      ),
    ])
  } catch {
    return null
  }
}

function webNotificationPresent(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof Notification !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.serviceWorker
  )
}

/**
 * The web's own answer, from the Permissions API where there is one.
 *
 * `Notification.permission` is the older reading and the two disagree: a
 * Chromium granted through automation reports `denied` on the constructor and
 * `granted` on the query, and a WebKit in the same state reports `default`
 * against `granted` (measured with Playwright's `grantPermissions`). The query
 * is the answer that matches what the page can actually do, and it is the same
 * door geolocation reads through, so both gated capabilities agree. The
 * constructor stays as the fallback for engines whose query does not know the
 * name.
 */
async function webPermission(): Promise<NotifyPermission> {
  if (typeof navigator !== "undefined" && navigator.permissions) {
    try {
      const status = await navigator.permissions.query({
        name: "notifications" as PermissionName,
      })
      return normalize(status.state)
    } catch {
      //the name is unknown to this engine's query — the constructor still knows
    }
  }
  return normalize(Notification.permission)
}

/** Current permission without prompting. Never rejects. */
export async function checkNotifyPermission(): Promise<NotifyPermission> {
  if (nativePlugin()) {
    try {
      const status = await LocalNotifications.checkPermissions()
      return normalize(status.display)
    } catch {
      return "unavailable"
    }
  }
  if (isNativePlatform()) return "unavailable"
  if (!webNotificationPresent()) return "unavailable"
  const state = await webPermission()
  if (state === "granted") {
    //Granted is only real if something can carry the banner. A page whose
    //worker has not registered yet cannot show one, and saying "granted" would
    //make the next call look like a bug rather than a state.
    return (await registration()) ? "granted" : "unavailable"
  }
  return state
}

/** Ask. Resolves the state afterwards, prompt included; never rejects. */
export async function requestNotifyPermission(): Promise<NotifyPermission> {
  if (nativePlugin()) {
    try {
      const status = await LocalNotifications.requestPermissions()
      return normalize(status.display)
    } catch {
      return "unavailable"
    }
  }
  if (isNativePlatform()) return "unavailable"
  if (!webNotificationPresent()) return "unavailable"
  try {
    await Notification.requestPermission()
    //Re-read rather than trust the prompt's own return: the query is the
    //accurate one, and the two do not always agree.
    return await checkNotifyPermission()
  } catch {
    return "unavailable"
  }
}

/**
 * What the app cannot do here even once the permission is granted, or `null`
 * when nothing is withheld. The third state keep-awake established: the call
 * resolves and the user still sees nothing.
 */
export function getNotifyCaveat(): string | null {
  if (nativePlugin()) {
    //iOS withholds nothing here. The first draft of this string said a
    //notification posted while the app is in front is delivered silently; the
    //simulator disproved it in one screenshot — the banner appears over the
    //app, because the plugin presents foreground notifications with badge,
    //sound, banner and list by default.
    if (isIOS()) return null
    return "Android fires a scheduled notification as an inexact alarm, so it can arrive a little late while the device is dozing. The exact kind is not asked for, because asking throws the user out of the app and into a system settings screen."
  }
  if (isNativePlatform())
    return "This binary was built before the notifications plugin; a rebuild carries it."
  return "A browser shows a notification only when the open app asks for one, through the page's own service worker. No browser can schedule one for later, so scheduling here resolves unsupported rather than waiting on a timer. On iOS a browser tab cannot show one at all: the page has to be installed to the home screen first."
}

/** Show one now. Resolves the outcome; never rejects. */
export async function notify({
  title,
  body,
  id = freshId(),
}: NotifyOptions): Promise<NotifyOutcome> {
  const permission = await checkNotifyPermission()
  if (permission === "unavailable") return "unavailable"
  //`prompt` or `denied`, as read: a caller has to tell "ask" from "refused"
  if (permission !== "granted") return permission
  if (nativePlugin()) {
    try {
      await LocalNotifications.schedule({
        notifications: [{ id, title, body, isExactNotification: false }],
      })
      return "shown"
    } catch {
      return "unavailable"
    }
  }
  const reg = await registration(true)
  if (!reg) return "unavailable"
  try {
    await reg.showNotification(title, { body, tag: String(id) })
    return "shown"
  } catch {
    return "unavailable"
  }
}

/**
 * Ask the OS to fire one later. Resolves `"unsupported"` on the web, where no
 * engine implements notification triggers; a timer in the page would only fire
 * while the page is open, which is not what the caller asked for.
 */
export async function scheduleNotification({
  title,
  body,
  at,
  id = freshId(),
}: ScheduleOptions): Promise<ScheduleOutcome> {
  if (!nativePlugin()) return "unsupported"
  const permission = await checkNotifyPermission()
  if (permission === "unavailable") return "unsupported"
  if (permission !== "granted") return permission
  try {
    await LocalNotifications.schedule({
      notifications: [
        { id, title, body, schedule: { at }, isExactNotification: false },
      ],
    })
    return "scheduled"
  } catch {
    return "unsupported"
  }
}

/**
 * What is still to come. Empty on the web.
 *
 * The plugin's own "pending" list is not that: a delivered notification keeps
 * its storage record so it stays queryable, so the list goes on naming one that
 * already appeared, and cancelling it does not take it out (measured on the
 * Pixel emulator: one scheduled for 19:41:20 fired at 19:41:37 and was still
 * listed at 19:47, before and after a cancel). Everything whose time has passed
 * is dropped here, unless it repeats and therefore has a next time.
 */
export async function listScheduledNotifications(): Promise<
  ScheduledNotification[]
> {
  if (!nativePlugin()) return []
  try {
    const { notifications } = await LocalNotifications.getPending()
    const now = Date.now()
    return notifications
      .filter((n) => {
        const at = n.schedule?.at
        if (!at) return false
        return n.schedule?.repeats === true || new Date(at).getTime() > now
      })
      .map((n) => ({
        id: n.id,
        title: n.title ?? "",
        body: n.body ?? "",
        at: n.schedule?.at ? new Date(n.schedule.at) : null,
      }))
  } catch {
    return []
  }
}

/**
 * Take one back. On the web this closes a banner that is still on screen,
 * matched by the id the notify used as its tag; on native it cancels the alarm.
 */
export async function cancelNotification(id: number): Promise<void> {
  if (nativePlugin()) {
    try {
      await LocalNotifications.cancel({ notifications: [{ id }] })
    } catch {}
    return
  }
  const reg = await registration()
  if (!reg) return
  try {
    const open = await reg.getNotifications({ tag: String(id) })
    for (const n of open) n.close()
  } catch {}
}
