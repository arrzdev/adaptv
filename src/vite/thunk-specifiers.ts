/**
 * Read the literal import specifier out of a component thunk
 * (`() => import("@/components/splash-screen")`). Used at stamp time to turn a
 * config-level thunk into a static import in the generated root. The specifier
 * must be a single literal string — a variable or template would defeat static
 * extraction, so we throw loudly instead of guessing.
 */
export function extractThunkSpecifier(
  field: string,
  thunk: unknown,
): string {
  if (typeof thunk !== "function") {
    throw new Error(
      `[nativ] config field "${field}" must be a thunk: () => import("...")`,
    )
  }

  const source = thunk.toString()
  const matches = [...source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)]

  if (matches.length === 0) {
    throw new Error(
      `[nativ] config field "${field}" must be () => import("<module>") with a literal specifier (got: ${source})`,
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `[nativ] config field "${field}" must contain exactly one dynamic import (found ${matches.length})`,
    )
  }

  return matches[0][1]
}
