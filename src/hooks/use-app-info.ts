import { useEffect, useState } from "react"
import type { AppInfo } from "#adaptv/capabilities/app-info"
import {
  getAppInfo,
  getAppInfoCaveat,
} from "#adaptv/capabilities/app-info"

export interface UseAppInfoResult {
  /** `null` until the first read resolves; it resolves once and never changes. */
  info: AppInfo | null
  /** What this target will not answer, or `null` when it answers everything. */
  caveat: string | null
}

/**
 * The running app's name, identity, version and build.
 *
 * `null` while the read is in flight rather than a record of nulls, because a
 * settings row has to be able to show "reading" instead of flashing "none" for
 * a version the app is about to know. The read happens once per process: none
 * of these can change while the app is alive.
 *
 * ```tsx
 * const { info, caveat } = useAppInfo()
 * return <Text>{info ? `${info.version ?? "web"} (${info.build ?? "-"})` : "…"}</Text>
 * ```
 */
export function useAppInfo(): UseAppInfoResult {
  const [info, setInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    let live = true
    getAppInfo().then((value) => {
      if (live) setInfo(value)
    })
    return () => {
      live = false
    }
  }, [])

  return { info, caveat: getAppInfoCaveat() }
}
