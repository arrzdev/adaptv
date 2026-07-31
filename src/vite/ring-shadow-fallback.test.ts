import { describe, expect, it, vi } from "vitest"
import {
  RING_CARRIERS,
  RING_INSET_ORDER_MESSAGE,
  rewriteRingShadow,
  usesEmptyRingFallback,
} from "#adaptv/vite/ring-shadow-fallback"

// Verbatim tailwindcss@4.2.4 output. Copied from its compiler, not hand-written — the
// rewrite is a text transform on someone else's generated CSS, so a paraphrase would test
// the wrong thing.
const RING_1 =
  ".ring-1 { --tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color, currentcolor); box-shadow: var(--tw-inset-shadow), var(--tw-inset-ring-shadow), var(--tw-ring-offset-shadow), var(--tw-ring-shadow), var(--tw-shadow); }"
const RING_OFFSET_2 =
  ".ring-offset-2 { --tw-ring-offset-width: 2px; --tw-ring-offset-shadow: var(--tw-ring-inset,) 0 0 0 var(--tw-ring-offset-width) var(--tw-ring-offset-color); }"
const RING_INSET = ".ring-inset { --tw-ring-inset: inset; }"
const RESET =
  "*, ::before, ::after, ::backdrop { --tw-ring-color: initial; --tw-ring-shadow: 0 0 #0000; --tw-ring-inset: initial; }"
const SHEET = [RING_1, RING_OFFSET_2, RING_INSET, RESET].join("\n")

describe("rewriteRingShadow", () => {
  // the bug: Chromium 113–118 drop any declaration containing `var(--x,)` when `--x` is a
  // registered property with no initial-value. That is this exact idiom.
  it("removes every empty var() fallback", () => {
    const out = rewriteRingShadow(SHEET) as string
    expect(out).not.toContain("var(--tw-ring-inset,)")
    expect(usesEmptyRingFallback(out)).toBe(false)
  })

  // Caught during the first device build, before it shipped: `--adaptv-ring` and
  // `--adaptv-ring-offset` are adaptv's PUBLIC focus-ring tokens (patches.css writes
  // `outline: 2px solid var(--adaptv-ring, currentColor)`), and a consumer may set them on
  // `:root`. Using those names as carriers would make every `ring-*` element redefine the
  // focus-ring colour as a box-shadow body, killing `:focus-visible` on EVERY browser —
  // a much worse bug than the one being fixed, and invisible in the fixed browsers' tests.
  it("never reuses adaptv's public ring tokens as carriers", () => {
    for (const taken of RING_CARRIERS.collidesWith) {
      expect(RING_CARRIERS.ring).not.toBe(taken)
      expect(RING_CARRIERS.ringOffset).not.toBe(taken)
    }
    // and the rewritten sheet must not write them either
    const out = rewriteRingShadow(SHEET) as string
    expect(out).not.toMatch(/--adaptv-ring\s*:/)
    expect(out).not.toMatch(/--adaptv-ring-offset\s*:/)
  })

  it("carries the ring body in an UNREGISTERED property", () => {
    const out = rewriteRingShadow(SHEET) as string
    expect(out).toContain(
      "--adaptv-tw-ring:0 0 0 calc(1px + var(--tw-ring-offset-width)) var(--tw-ring-color, currentcolor);--tw-ring-shadow:var(--adaptv-tw-ring);",
    )
    // registering it would reintroduce the bug it exists to dodge
    expect(out).not.toContain("@property --adaptv-tw-ring")
  })

  it("rewrites ring-offset with its own carrier, not the ring's", () => {
    const out = rewriteRingShadow(SHEET) as string
    expect(out).toContain(
      "--tw-ring-offset-shadow:var(--adaptv-tw-ring-offset)",
    )
  })

  // `.ring-inset` used to set a variable the width rule read; now it re-declares the whole
  // shadow, which only works because it is emitted after the widths (guarded below).
  it("turns ring-inset into a full re-declaration", () => {
    const out = rewriteRingShadow(SHEET) as string
    expect(out).toContain(
      "--tw-ring-shadow:inset var(--adaptv-tw-ring,0 0 #0000);",
    )
    expect(out).toContain(
      "--tw-ring-offset-shadow:inset var(--adaptv-tw-ring-offset,0 0 #0000);",
    )
  })

  // Tailwind's reset sets `--tw-ring-inset: initial`, which is not the keyword and must
  // survive untouched — rewriting it would hand every element an inset ring.
  it("leaves the reset's `--tw-ring-inset: initial` alone", () => {
    expect(rewriteRingShadow(SHEET) as string).toContain(
      "--tw-ring-inset: initial;",
    )
  })

  it("is a no-op on CSS that never used the idiom", () => {
    expect(rewriteRingShadow(".a { color: red }")).toBeNull()
    expect(rewriteRingShadow(RESET)).toBeNull()
  })

  // running twice must not double-wrap: the plugin sees dev and build, and HMR re-transforms
  it("is idempotent", () => {
    const once = rewriteRingShadow(SHEET) as string
    expect(rewriteRingShadow(once)).toBeNull()
  })

  // If Tailwind ever emits ring-inset first, the rewritten inset rule would lose the cascade
  // and insets would render ring-less. Refuse and say so, rather than half-work.
  it("refuses, loudly, if ring-inset is emitted before the widths", () => {
    const onOutOfOrder = vi.fn()
    const reordered = [RING_INSET, RING_1].join("\n")
    expect(rewriteRingShadow(reordered, onOutOfOrder)).toBeNull()
    expect(onOutOfOrder).toHaveBeenCalledOnce()
    expect(RING_INSET_ORDER_MESSAGE).toContain("113–118")
  })

  // minified output has no spaces and drops the final semicolon before `}`
  it("handles minified output", () => {
    const min =
      ".ring-1{--tw-ring-shadow:var(--tw-ring-inset,) 0 0 0 1px var(--tw-ring-color,currentcolor)}.ring-inset{--tw-ring-inset:inset}"
    const out = rewriteRingShadow(min) as string
    expect(out).not.toContain("var(--tw-ring-inset,)")
    expect(out).toContain("--tw-ring-shadow:var(--adaptv-tw-ring)}")
    expect(out).toContain(
      "--tw-ring-shadow:inset var(--adaptv-tw-ring,0 0 #0000);",
    )
  })

  // Measured on WebView 113: with no fallback, `--tw-ring-offset-shadow` computed to "" on
  // any element that had `ring-inset` but no `ring-offset-*` (i.e. almost all of them), and
  // that guaranteed-invalid value poisoned the whole `box-shadow` — ring correct, page wrong.
  it("gives every carrier reference a valid fallback", () => {
    const out = rewriteRingShadow(SHEET) as string
    // `.ring-inset` is the rule that needs them: it references carriers it does not set.
    // A width rule sets its own carrier in the same declaration, so it is always safe.
    const insetRule = out
      .split("\n")
      .find((line) => line.includes(".ring-inset")) as string
    expect(insetRule).toContain("var(--adaptv-tw-ring,0 0 #0000)")
    expect(insetRule).toContain("var(--adaptv-tw-ring-offset,0 0 #0000)")
  })

  // variants are the same declaration under a different selector — they must come along,
  // otherwise focus states specifically stay broken
  it("rewrites variants too", () => {
    const variant =
      ".focus\\:ring-2:focus { --tw-ring-shadow: var(--tw-ring-inset,) 0 0 0 2px var(--tw-ring-color, currentcolor); }"
    expect(rewriteRingShadow(variant) as string).toContain(
      "--tw-ring-shadow:var(--adaptv-tw-ring)",
    )
  })
})
