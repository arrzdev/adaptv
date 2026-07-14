/**
 * Serialize a config value into a JavaScript source expression for a generated
 * file. Unlike `JSON.stringify` this survives `Infinity` / `NaN` — TanStack
 * router options legitimately use `defaultPreloadStaleTime: Infinity`, which
 * JSON would silently turn into `null`.
 */
export function serializeValue(value: unknown): string {
  if (value === Number.POSITIVE_INFINITY) return "Number.POSITIVE_INFINITY"
  if (value === Number.NEGATIVE_INFINITY) return "Number.NEGATIVE_INFINITY"
  if (typeof value === "number" && Number.isNaN(value)) return "Number.NaN"

  if (Array.isArray(value)) {
    return `[${value.map(serializeValue).join(", ")}]`
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(
      ([key, item]) => `${JSON.stringify(key)}: ${serializeValue(item)}`,
    )
    return `{ ${entries.join(", ")} }`
  }

  return JSON.stringify(value)
}
