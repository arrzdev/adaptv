import { useCallback, useEffect, useState } from "react"
import type {
  NotifyOptions,
  NotifyOutcome,
  NotifyPermission,
  ScheduledNotification,
  ScheduleOptions,
  ScheduleOutcome,
} from "#adaptv/capabilities/notifications"
import {
  cancelNotification,
  checkNotifyPermission,
  getNotifyCaveat,
  listScheduledNotifications,
  notify,
  requestNotifyPermission,
  scheduleNotification,
} from "#adaptv/capabilities/notifications"

export type UseNotificationsResult = {
  /** `null` until the first read settles, then the four-state permission. */
  permission: NotifyPermission | null
  /** What is withheld even when granted, or `null` when nothing is. */
  caveat: string | null
  /** Everything the OS is still holding, refreshed after every call that changes it. */
  pending: ScheduledNotification[]
  request: () => Promise<NotifyPermission>
  notify: (options: NotifyOptions) => Promise<NotifyOutcome>
  schedule: (options: ScheduleOptions) => Promise<ScheduleOutcome>
  cancel: (id: number) => Promise<void>
  refresh: () => Promise<void>
}

/**
 * Local notifications as a hook. The permission is read in an effect rather
 * than during render, because the server has no answer and a guess would
 * mismatch on hydration; the caveat is read there for the same reason.
 */
export function useNotifications(): UseNotificationsResult {
  const [permission, setPermission] = useState<NotifyPermission | null>(
    null,
  )
  const [caveat, setCaveat] = useState<string | null>(null)
  const [pending, setPending] = useState<ScheduledNotification[]>([])

  const refresh = useCallback(async () => {
    setPending(await listScheduledNotifications())
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      const state = await checkNotifyPermission()
      if (!alive) return
      setPermission(state)
      setCaveat(getNotifyCaveat())
      setPending(await listScheduledNotifications())
    })()
    return () => {
      alive = false
    }
  }, [])

  const request = useCallback(async () => {
    const state = await requestNotifyPermission()
    setPermission(state)
    setCaveat(getNotifyCaveat())
    return state
  }, [])

  const show = useCallback(async (options: NotifyOptions) => {
    const outcome = await notify(options)
    setPermission(await checkNotifyPermission())
    return outcome
  }, [])

  const schedule = useCallback(
    async (options: ScheduleOptions) => {
      const outcome = await scheduleNotification(options)
      await refresh()
      return outcome
    },
    [refresh],
  )

  const cancel = useCallback(
    async (id: number) => {
      await cancelNotification(id)
      await refresh()
    },
    [refresh],
  )

  return {
    permission,
    caveat,
    pending,
    request,
    notify: show,
    schedule,
    cancel,
    refresh,
  }
}
