import type { Ref } from "react"
import { useCallback } from "react"

/** Assign a DOM node to both an internal `RefObject` and a forwarded `ref`. */
export function useMergedRef<T>(
  localRef: { current: T | null },
  forwardedRef: Ref<T>,
) {
  return useCallback(
    (node: T | null) => {
      localRef.current = node
      if (typeof forwardedRef === "function") forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [localRef, forwardedRef],
  )
}
