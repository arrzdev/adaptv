import { fileURLToPath } from "node:url"
import { adaptv } from "@arrzdev/adaptv/vite"
import type { Plugin } from "vite"
import { defineConfig } from "vite"
import { shared } from "./vite.shared"

/*
 * The same lab app, built with NO Tailwind (docs/decisions/styling.md §0.1, §9): no
 * `@tailwindcss/vite`, and no `tailwindcss`, `tailwind-merge` or `clsx` anywhere in the
 * build's module graph. The pages keep their Tailwind class names, which here style
 * nothing; adaptv's components must still look and behave as they do in the Tailwind
 * build, and `playwright.plain.config.ts` runs the component and precedence specs
 * against this build to prove it.
 *
 * Two switches make it plain, and the guard below fails the build if either leaks:
 * - the stylesheet: adaptv.config.ts reads PLAYGROUND_CSS and picks `plain.css`,
 *   which imports `@arrzdev/adaptv/styles.css` and no Tailwind;
 * - the page helper: `@/utils/cn` is clsx + tailwind-merge, so it is swapped for a
 *   plain join.
 */
//Set here, not only by the runner, so `vite --config vite.plain.config.ts` is the
//whole recipe: adaptv() reads adaptv.config.ts in this same process.
process.env.PLAYGROUND_CSS = "plain"

/** A bare specifier, or a resolved path, that belongs to Tailwind or its helpers. */
const TAILWIND_SPECIFIER =
  /^(tailwindcss|@tailwindcss\/[^/]+|tailwind-merge|clsx)(\/|$)/
const TAILWIND_PATH =
  /[\\/]node_modules[\\/](tailwindcss|@tailwindcss[\\/][^\\/]+|tailwind-merge|clsx)[\\/]/
/** What Tailwind's compiler leaves in CSS, or what only Tailwind's compiler accepts. */
const TAILWIND_CSS =
  /\/\*! tailwindcss|--tw-|@import\s+["']tailwindcss|@(apply|theme|utility|custom-variant|source|tailwind)\b/

/** Tailwind's banner is a `/*!` comment and stays; prose comments that NAME `@theme` go. */
function tailwindIn(css: string): string | undefined {
  return css.replace(/\/\*(?!!)[\s\S]*?\*\//g, "").match(TAILWIND_CSS)?.[0]
}

/**
 * Fails the dev server and the build the moment Tailwind enters this app: an import that
 * resolves to it (JS or CSS), a module loaded from it, or emitted CSS that only its
 * compiler produces or accepts.
 */
function noTailwind(): Plugin {
  const fail = (what: string): never => {
    throw new Error(`[playground:no-tailwind] ${what}`)
  }
  return {
    name: "playground:no-tailwind",
    enforce: "pre",
    configResolved(config) {
      const plugin = config.plugins.find((p) =>
        p.name.startsWith("@tailwindcss/"),
      )
      if (plugin) fail(`the plain build runs ${plugin.name}`)
    },
    //filtered, so the bundler only calls back into JS for the modules in question
    resolveId: {
      filter: { id: TAILWIND_SPECIFIER },
      handler(source, importer) {
        fail(`${importer ?? "an entry"} imports ${source}`)
      },
    },
    load: {
      filter: { id: TAILWIND_PATH },
      handler(id) {
        fail(`the build loads ${id}`)
      },
    },
    transform: {
      filter: { id: /\.css($|\?)/ },
      handler(code, id) {
        const hit = tailwindIn(code)
        if (hit) fail(`${id} carries Tailwind: ${hit}`)
        return null
      },
    },
    generateBundle(_options, bundle) {
      for (const id of this.getModuleIds()) {
        if (TAILWIND_PATH.test(id)) fail(`the bundle contains ${id}`)
      }
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css"))
          continue
        const hit = tailwindIn(String(file.source))
        if (hit) fail(`${file.fileName} carries Tailwind: ${hit}`)
      }
    },
  }
}

export default defineConfig({
  ...shared,
  resolve: {
    ...shared.resolve,
    alias: [
      {
        find: /^@\/utils\/cn$/,
        replacement: fileURLToPath(
          new URL("./src/utils/cn.plain.ts", import.meta.url),
        ),
      },
    ],
  },
  plugins: [noTailwind(), adaptv()],
})
