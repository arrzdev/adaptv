import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { __unstable__loadDesignSystem, compile } from "tailwindcss"

/*
 * Compile adaptv's real stylesheet with the real Tailwind, so the style tests can assert
 * the CSS a consumer actually gets instead of the source text of a file.
 *
 * Text assertions are still the right tool for a *spelling* that no DOM can tell apart
 * (the `var()`-before-`env()` inset ordering, the `touch-action` longhand — see the
 * comments in safe-area.test.ts / utils.test.ts). They are the WRONG tool for anything
 * Tailwind has to parse: `@utility` and `--value()` fail SOFT — an unparseable functional
 * utility simply never emits a rule, no error — so a file can contain exactly the right
 * characters and still ship nothing. Only the compiled output catches that.
 *
 * `import.meta.url` is not a file: URL under the happy-dom environment, so resolve from cwd.
 */
const STYLES_DIR = resolve(process.cwd(), "src/styles")

/** The `@layer` statement a consumer's entry stylesheet must open with (docs/decisions/styling.md §6.0). */
export const CONSUMER_LAYER_ORDER =
  "@layer theme, base, adaptv, components, utilities;"

/**
 * Compile `css` (Tailwind's theme + utilities are imported for you) and emit rules for
 * `candidates`, exactly as if they had been found in a consumer's markup.
 */
export async function compileCss(
  css: string,
  candidates: string[],
): Promise<string> {
  const compiler = await compile(withTailwind(css), COMPILE_OPTIONS)
  return compiler.build(candidates)
}

/**
 * Every utility Tailwind can generate — its whole class list, ~22k candidates — compiled
 * into one sheet (~5 MB, a few hundred ms).
 *
 * For claims about what Tailwind CAN emit rather than about one utility.
 */
export async function compileEveryUtility(): Promise<string> {
  const source = withTailwind("")
  const system = await __unstable__loadDesignSystem(
    source,
    COMPILE_OPTIONS,
  )
  const compiler = await compile(source, COMPILE_OPTIONS)
  return compiler.build(system.getClassList().map(([name]) => name))
}

function withTailwind(css: string): string {
  return `${CONSUMER_LAYER_ORDER}
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
${css}`
}

const COMPILE_OPTIONS = {
  base: STYLES_DIR,
  loadStylesheet: async (id: string, base: string) => {
    const path = id.startsWith("tailwindcss")
      ? resolve(process.cwd(), "node_modules", id)
      : resolve(base, id)
    return {
      path,
      base: dirname(path),
      content: readFileSync(path, "utf8"),
    }
  },
}

/**
 * Compile the Tailwind entry (`src/styles/tailwind.css`, which imports all of
 * `styles.css`) for `candidates` — every adaptv rule, plus the utilities and variants
 * only a Tailwind app gets.
 */
export function compileAdaptvStyles(
  candidates: string[],
): Promise<string> {
  return compileCss(`@import "./tailwind.css";`, candidates)
}

/** The body of one compiled rule, whitespace-collapsed, or `null` when it never emitted. */
export function ruleFor(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  return match ? match[1].replace(/\s+/g, " ").trim() : null
}
