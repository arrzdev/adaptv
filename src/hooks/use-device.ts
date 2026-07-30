import { useEffect, useState } from "react"
import type { DeviceInfo } from "#adaptv/capabilities/device"
import {
  getDeviceId,
  getDeviceInfo,
  getLanguageTag,
} from "#adaptv/capabilities/device"

export type UseDeviceResult = {
  /** The immutable device record, or `null` until the first read settles. */
  info: DeviceInfo | null
  /** Stable per-install id on native; `null` on web — see `getDeviceId`. */
  id: string | null
  /** Current BCP-47 tag. Empty string until mount (the server has no locale). */
  languageTag: string
  /** True until `info` is available. One tick on web, one bridge hop on native. */
  loading: boolean
}

/**
 * Device facts as a hook. `info` is `null` while loading and every field inside
 * it is `null` where the platform won't answer — a device sheet built on this
 * can therefore render "not reported here" instead of an empty row, which on
 * web is most of the record.
 *
 * The underlying read is memoised per process, so mounting this in ten places
 * costs one bridge hop.
 */
export function useDevice(): UseDeviceResult {
  const [info, setInfo] = useState<DeviceInfo | null>(null)
  const [id, setId] = useState<string | null>(null)
  const [languageTag, setLanguageTag] = useState("")

  useEffect(() => {
    let isActive = true
    setLanguageTag(getLanguageTag())
    void getDeviceInfo().then((next) => {
      if (isActive) setInfo(next)
    })
    void getDeviceId().then((next) => {
      if (isActive) setId(next)
    })
    return () => {
      isActive = false
    }
  }, [])

  return { info, id, languageTag, loading: info === null }
}
