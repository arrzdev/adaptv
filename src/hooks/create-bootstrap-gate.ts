import { useSyncExternalStore } from "react"

export type BootstrapGate = {
  /** Reactive bootstrap-ready flag. Returns `false` during SSR. */
  useBootstrapReady: () => boolean
  getBootstrapReady: () => boolean
  setBootstrapReady: () => void
  resetBootstrapReady: () => void
  subscribeBootstrapReady: (onStoreChange: () => void) => () => void
}

/** Generic ready gate for splash overlays and cold-start bootstrap work. */
export function createBootstrapGate(): BootstrapGate {
  let isReady = false
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of listeners) listener()
  }

  function getBootstrapReady() {
    return isReady
  }

  function subscribeBootstrapReady(onStoreChange: () => void) {
    listeners.add(onStoreChange)
    return () => {
      listeners.delete(onStoreChange)
    }
  }

  function setBootstrapReady() {
    if (isReady) return
    isReady = true
    notify()
  }

  function resetBootstrapReady() {
    if (!isReady) return
    isReady = false
    notify()
  }

  function useBootstrapReady() {
    return useSyncExternalStore(
      subscribeBootstrapReady,
      getBootstrapReady,
      () => false,
    )
  }

  return {
    useBootstrapReady,
    getBootstrapReady,
    setBootstrapReady,
    resetBootstrapReady,
    subscribeBootstrapReady,
  }
}
