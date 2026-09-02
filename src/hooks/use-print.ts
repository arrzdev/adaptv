import { useCallback, useState, useSyncExternalStore } from "react"
import type {
  PrintOptions,
  PrintOutcome,
  PrintStatus,
} from "#adaptv/capabilities/print"
import {
  getPrintStatus,
  isPrinting,
  print as printNow,
  subscribePrint,
} from "#adaptv/capabilities/print"

export type UsePrintResult = {
  /** Whether a print dialog can open here. */
  status: PrintStatus
  /** `true` between the call and its outcome. */
  printing: boolean
  /** Outcome of the most recent print, or `null` before the first. */
  last: PrintOutcome | null
  /** Open the print dialog. Resolves the outcome; never rejects. */
  print: (options?: PrintOptions) => Promise<PrintOutcome>
}

function unsupported(): PrintStatus {
  return "unsupported"
}

/**
 * The print dialog, as a hook. `status` is read on the client and reads
 * `unsupported` during server rendering, so a button can hide itself where
 * nothing would answer it; `last` is what the button should show afterwards,
 * because a print that resolved `silent` looks exactly like one that opened
 * unless something says so.
 */
export function usePrint(): UsePrintResult {
  const status = useSyncExternalStore(
    subscribePrint,
    getPrintStatus,
    unsupported,
  )
  const printing = useSyncExternalStore(
    subscribePrint,
    isPrinting,
    () => false,
  )
  const [last, setLast] = useState<PrintOutcome | null>(null)

  const print = useCallback(async (options?: PrintOptions) => {
    const outcome = await printNow(options)
    setLast(outcome)
    return outcome
  }, [])

  return { status, printing, last, print }
}
