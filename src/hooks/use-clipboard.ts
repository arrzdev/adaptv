import { useCallback, useEffect, useState } from "react"
import type {
  ClipboardPermission,
  ClipboardStatus,
} from "#adaptv/capabilities/clipboard"
import {
  checkClipboardReadPermission,
  isClipboardReadSupported,
  isClipboardWriteSupported,
  readClipboardText,
  writeClipboardText,
} from "#adaptv/capabilities/clipboard"

export type UseClipboardResult = {
  /** Whether copying works here. Effectively always true on a real target. */
  canWrite: boolean
  /** Whether pasting works here. `false` in every non-secure context. */
  canRead: boolean
  /** Read permission, four-state. `"unavailable"` ⇒ don't render a paste button. */
  readPermission: ClipboardPermission
  /** Copy. Resolves to the outcome; never rejects. */
  copy: (text: string) => Promise<ClipboardStatus>
  /** Paste. Resolves to the text, or `null` when refused/unsupported. */
  paste: () => Promise<string | null>
  /** The last text read by {@link UseClipboardResult.paste}. */
  text: string | null
  /** Outcome of the last copy or paste, or `null` before the first. */
  status: ClipboardStatus | null
  /** Re-read the permission (after the user changes it in site settings). */
  refreshPermission: () => Promise<ClipboardPermission>
}

/**
 * The clipboard as a hook — with read and write kept apart, because they are
 * different capabilities: copying is ungated, pasting is permission-gated on
 * Chromium and gesture-gated on WebKit. A single `supported` flag would have to
 * lie about one of them.
 *
 * `readPermission` starts at `"prompt"` and settles on mount, so a paste button
 * gated on `canRead && readPermission !== "unavailable"` never flashes.
 */
export function useClipboard(): UseClipboardResult {
  const [canWrite, setCanWrite] = useState(false)
  const [canRead, setCanRead] = useState(false)
  const [readPermission, setReadPermission] =
    useState<ClipboardPermission>("prompt")
  const [text, setText] = useState<string | null>(null)
  const [status, setStatus] = useState<ClipboardStatus | null>(null)

  useEffect(() => {
    //probed in an effect, not during render: `navigator` does not exist on the
    //server, and a render-time read would hydrate to the wrong answer
    setCanWrite(isClipboardWriteSupported())
    setCanRead(isClipboardReadSupported())
    let isActive = true
    void checkClipboardReadPermission().then((next) => {
      if (isActive) setReadPermission(next)
    })
    return () => {
      isActive = false
    }
  }, [])

  const copy = useCallback(async (value: string) => {
    const next = await writeClipboardText(value)
    setStatus(next)
    return next
  }, [])

  const paste = useCallback(async () => {
    const result = await readClipboardText()
    setStatus(result.status)
    setText(result.text)
    //a read is also the most accurate permission probe there is — Chromium
    //flips clipboard-read to "granted" only once a read has actually happened
    setReadPermission(await checkClipboardReadPermission())
    return result.text
  }, [])

  const refreshPermission = useCallback(async () => {
    const next = await checkClipboardReadPermission()
    setReadPermission(next)
    return next
  }, [])

  return {
    canWrite,
    canRead,
    readPermission,
    copy,
    paste,
    text,
    status,
    refreshPermission,
  }
}
