import { resolve } from "node:path"
import { bundle } from "lightningcss"
import { describe, expect, it } from "vitest"

/*
 * `styles.css` is plain CSS (docs/decisions/styling.md §0.1): it bundles with no Tailwind,
 * and no Tailwind at-rule survives into it. `pnpm build:check` checks the shipped copy the
 * same way (scripts/check-dist-styles.mjs); this is the same claim on `src/`, so a
 * regression fails in `pnpm test` before a build.
 */

const STYLES = resolve(process.cwd(), "src/styles")

function bundled(entry: string): string {
  return bundle({ filename: resolve(STYLES, entry), errorRecovery: false })
    .code.toString()
    .replace(/\/\*[\s\S]*?\*\//g, "")
}

describe("styles.css with no Tailwind", () => {
  it("bundles, and keeps no Tailwind at-rule or function", () => {
    const css = bundled("index.css")
    for (const syntax of [
      "@utility",
      "@custom-variant",
      "@variant",
      "@theme",
      "@source",
      "@apply",
      "--spacing(",
      "--value(",
    ]) {
      expect(css, syntax).not.toContain(syntax)
    }
  })

  it("ships the three utility classes as plain classes in adaptv.utilities", () => {
    const css = bundled("index.css")
    const utilities = css.slice(css.indexOf("@layer adaptv.utilities {"))
    for (const name of [
      ".selectable",
      ".scrollbar-hidden",
      ".scrollbar-visible",
    ])
      expect(utilities).toContain(name)
  })

  it("defines the safe-area variables a plain-CSS app writes instead of p-safe", () => {
    const css = bundled("index.css")
    for (const side of ["top", "right", "bottom", "left"])
      expect(css).toContain(`--adaptv-inset-${side}:`)
  })

  it("leaves every Tailwind spelling to tailwind.css", () => {
    const css = bundled("tailwind.css")
    expect(css).toContain("@custom-variant")
    expect(css).toContain("@utility pb-safe-or-*")
  })
})
