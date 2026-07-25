import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

//The safe-area inset contract, guarded as text — DECISIONS.md §6.0 (B18). The rule
//is a source-ordering rule (`var(--safe-area-inset-*)` FIRST, `env()` only as
//fallback) that no DOM we can test against can tell apart from the naive spelling:
//happy-dom resolves both identically, and so does every engine except Android
//WebView < 140, the one that's actually broken. Locking the text is the only guard
//that fires. `import.meta.url` is not a file: URL under happy-dom, so resolve from cwd.
const SRC = join(process.cwd(), "src")
const SAFE_AREA_CSS = join(SRC, "styles/safe-area.css")
const safeAreaCss = readFileSync(SAFE_AREA_CSS, "utf8")

describe("safe-area.css — the locked inset contract", () => {
  //Capacitor's SystemBars injects `--safe-area-inset-*` on Android because `env()`
  //reads 0/wrong in WebView < 140 (crbug/40699457). Consume the var first, env() last.
  it("spells each inset var-first with env() as fallback", () => {
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(safeAreaCss).toContain(
        `--safe-${side}: var(--safe-area-inset-${side}, env(safe-area-inset-${side}, 0px))`,
      )
    }
  })

  it("carries the bug/decision reference so the ordering is not 'corrected' back", () => {
    expect(safeAreaCss).toContain("§6.0")
    expect(safeAreaCss).toContain("40699457")
  })

  //The whole tailwindcss-safe-area surface (p-safe, pt-safe, *-safe-offset-*, m-safe)
  //resolves through --twsa-safe-area-inset-*; rerouting those onto the contract vars is
  //what makes View/ScrollView/AvoidKeyboard/OrientationGuard compliant without churn.
  it("reroutes the tailwindcss-safe-area plugin vars onto the contract", () => {
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(safeAreaCss).toContain(
        `--twsa-safe-area-inset-${side}: var(--safe-${side})`,
      )
    }
  })
})

/** Recursively collect files under `dir` matching one of `exts`. */
function walk(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walk(full, exts))
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full)
    }
  }
  return out
}

describe("safe-area contract — bare env(safe-area-inset) is banned outside safe-area.css", () => {
  //`safe-area.css` is the single source of truth for the env() fallback; this guard is
  //why. Anywhere else — a component arbitrary value, an inline style, a JS probe —
  //bare env() silently reads 0 on the large Android WebView < 140 base. Reference the
  //contract var (`var(--safe-*)`) instead. This test itself and the contract file are
  //the only allowed occurrences.
  const files = walk(SRC, [".ts", ".tsx", ".css"]).filter(
    (f) => f !== SAFE_AREA_CSS && !f.endsWith("safe-area.test.ts"),
  )

  it.each(files.map((f) => [f.slice(SRC.length + 1), f] as const))(
    "%s consumes the contract var, not bare env()",
    (_rel, full) => {
      //strip comments so prose that *names* the banned spelling to explain it doesn't
      //read as a violation
      const code = readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "")
      expect(code).not.toMatch(/env\(\s*safe-area-inset/)
    },
  )
})
