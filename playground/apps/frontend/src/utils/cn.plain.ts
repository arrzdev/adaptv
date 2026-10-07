/*
 * `cn` in the no-Tailwind build (`vite.plain.config.ts` aliases `@/utils/cn` here):
 * the same call shape as clsx, joined in order, nothing merged. There are no Tailwind
 * rules in that build for two conflicting classes to fight over, and importing
 * `tailwind-merge` would put Tailwind back in the dependency graph the build exists to
 * keep clean.
 */

type ClassDictionary = Record<string, unknown>
type ClassValue =
  | ClassValue[]
  | ClassDictionary
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined

function flatten(value: ClassValue, out: string[]): void {
  if (!value) return
  if (typeof value === "string" || typeof value === "number") {
    out.push(String(value))
  } else if (Array.isArray(value)) {
    for (const item of value) flatten(item, out)
  } else if (typeof value === "object") {
    for (const [name, on] of Object.entries(value)) if (on) out.push(name)
  }
}

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = []
  flatten(inputs, out)
  return out.join(" ")
}
