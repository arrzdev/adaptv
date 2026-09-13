import type { Ref } from "react"
import { useCallback } from "react"

/**
 * Attach `node` to one ref and return how to detach it. A callback ref that returned a
 * cleanup (React 19) gets that cleanup back, never a second call with `null` — the
 * contract React itself keeps for a callback ref on a host element.
 */
function attach<T>(
  ref: Ref<T> | undefined,
  node: T,
): (() => void) | undefined {
  if (typeof ref === "function") {
    const cleanup = ref(node)
    return typeof cleanup === "function" ? cleanup : () => ref(null)
  }
  if (ref) {
    ref.current = node
    return () => {
      ref.current = null
    }
  }
  return undefined
}

/**
 * Assign a DOM node to an internal `RefObject` and to every forwarded ref.
 *
 * The merged callback returns a cleanup, so React 19 detaches through it instead of
 * calling it with `null`: each forwarded callback ref that returned a cleanup has that
 * cleanup run, and every other ref is set back to `null`. Without it a consumer's
 * cleanup would be dropped the moment a component merged its ref.
 */
export function useMergedRef<T>(
  localRef: { current: T | null },
  ...forwardedRefs: Array<Ref<T> | undefined>
) {
  //biome-ignore lint/correctness/useExhaustiveDependencies: the list holds each forwarded ref, spread; the count is fixed at each call site
  return useCallback(
    (node: T | null) => {
      localRef.current = node
      //React 19 never calls a ref that returns a cleanup with null — but a caller may
      if (node === null) {
        for (const ref of forwardedRefs) {
          if (typeof ref === "function") ref(null)
          else if (ref) ref.current = null
        }
        return
      }
      const detach = forwardedRefs.map((ref) => attach(ref, node))
      return () => {
        localRef.current = null
        for (const cleanup of detach) cleanup?.()
      }
    },
    [localRef, ...forwardedRefs],
  )
}
