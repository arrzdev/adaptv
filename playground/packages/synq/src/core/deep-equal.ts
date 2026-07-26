//structural equality used by the sync engine's push-skip guard (does the
//locally-merged row already match what the server holds?). small and
//dependency-free; arrays are order-sensitive, so set-valued fields must be
//materialized in a stable order before comparison.

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== "object") return false

  const aArr = Array.isArray(a)
  const bArr = Array.isArray(b)
  if (aArr !== bArr) return false

  if (aArr && bArr) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }

  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const aKeys = Object.keys(ao)
  const bKeys = Object.keys(bo)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.hasOwn(bo, key)) return false
    if (!deepEqual(ao[key], bo[key])) return false
  }
  return true
}
