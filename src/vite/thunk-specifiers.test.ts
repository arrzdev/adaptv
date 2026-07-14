import { describe, expect, it } from "vitest"
import { extractThunkSpecifier } from "#nativ/vite/thunk-specifiers"

//a stand-in thunk whose source we control — extraction only reads .toString(),
//so this exercises the parser without depending on how the runtime prints an
//actual arrow function.
function thunkWithSource(source: string) {
  return Object.assign(() => undefined, { toString: () => source })
}

describe("extractThunkSpecifier", () => {
  it("reads the literal specifier out of a thunk (esbuild output form)", () => {
    const thunk = thunkWithSource(
      '() => import("@/components/splash-screen")',
    )
    expect(extractThunkSpecifier("splash", thunk)).toBe(
      "@/components/splash-screen",
    )
  })

  it("accepts single quotes and surrounding whitespace", () => {
    const thunk = thunkWithSource("() => import( '@/x' )")
    expect(extractThunkSpecifier("x", thunk)).toBe("@/x")
  })

  it("throws when the field is not a function", () => {
    expect(() => extractThunkSpecifier("splash", "nope")).toThrow(
      /must be a thunk/,
    )
  })

  it("throws on a non-literal specifier (no import call)", () => {
    const thunk = thunkWithSource(
      "() => Promise.resolve({ default: null })",
    )
    expect(() => extractThunkSpecifier("splash", thunk)).toThrow(
      /literal specifier/,
    )
  })

  it("throws when more than one dynamic import is present", () => {
    const thunk = thunkWithSource(
      '() => { import("@/a"); return import("@/b") }',
    )
    expect(() => extractThunkSpecifier("multi", thunk)).toThrow(
      /exactly one dynamic import/,
    )
  })
})
