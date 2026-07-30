import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { compile } from "tailwindcss"

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

/** The `@layer` statement a consumer's entry stylesheet must open with (STYLING.md §6.0). */
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
  const compiler = await compile(
    `${CONSUMER_LAYER_ORDER}
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
${css}`,
    {
      base: STYLES_DIR,
      loadStylesheet: async (id, base) => {
        const path = id.startsWith("tailwindcss")
          ? resolve(process.cwd(), "node_modules", id)
          : resolve(base, id)
        return {
          path,
          base: dirname(path),
          content: readFileSync(path, "utf8"),
        }
      },
    },
  )

  return compiler.build(candidates)
}

/** Compile the whole shipped bundle (`src/styles/index.css`) for `candidates`. */
export function compileAdaptvStyles(
  candidates: string[],
): Promise<string> {
  return compileCss(`@import "./index.css";`, candidates)
}

/** The body of one compiled rule, whitespace-collapsed, or `null` when it never emitted. */
export function ruleFor(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css)
  return match ? match[1].replace(/\s+/g, " ").trim() : null
}
