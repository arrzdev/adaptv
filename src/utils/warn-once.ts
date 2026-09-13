/**
 * Development warnings that fire once per message for the life of the module, so a
 * list of a hundred misused components logs one line instead of a hundred (two hundred
 * under StrictMode's double mount).
 *
 * Each component makes its own: `createWarnOnce("Image")` prefixes every message with
 * `[adaptv] Image:` and dedupes by the key it is given.
 */
export interface WarnOnce {
  /** `console.error` the message, unless this key has already been reported. */
  warn(key: string, message: string): void
  /** Re-arm every key of this component. */
  reset(): void
}

const registry = new Set<WarnOnce>()

export function createWarnOnce(component: string): WarnOnce {
  const warned = new Set<string>()
  const instance: WarnOnce = {
    warn(key, message) {
      if (warned.has(key)) return
      warned.add(key)
      console.error(`[adaptv] ${component}: ${message}`)
    },
    reset() {
      warned.clear()
    },
  }
  registry.add(instance)
  return instance
}

/** Test seam: re-arm every component's warnings, so each case starts unwarned. */
export function resetWarnOnce(): void {
  for (const instance of registry) instance.reset()
}
