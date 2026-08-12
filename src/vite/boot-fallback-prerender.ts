import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin as EsbuildPlugin } from "esbuild"
import { build as esbuild } from "esbuild"
import type { BootCode } from "#adaptv/shell/boot-fallback.ts"
import { BOOT_CODES } from "#adaptv/shell/boot-fallback.ts"

/**
 * Render the app's error component to static HTML **at build time**, so the boot
 * fallback needs no bundle of its own. → `src/shell/boot-fallback.ts`
 *
 * ## Why the whole thing is bundled, including React
 *
 * `loadAppConfig` evaluates its esbuild output from a `data:` URL, which only
 * works because that bundle has zero static imports — a `data:` module has no
 * parent path, so it cannot resolve a bare specifier like `react-dom/server`. So
 * rather than mark React external and then need a temp file on disk to import
 * from, the generated entry pulls the renderer *into* the bundle and exports the
 * finished HTML string. One self-contained module, evaluated once, nothing
 * written to the consumer's tree.
 *
 * ## What this asks of the component
 *
 * That it renders standalone, with no props and no browser. Not a new
 * constraint: adaptv defaults to `render: "ssr"`, so every consumer component
 * already has to render in Node. Anything it reaches for that only exists in a
 * browser would already have broken the app's own server render.
 */

/** adaptv's own `src/`, for resolving the default component when the app overrides nothing. */
function adaptvSrcDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
}

/** The default screen's module path — adaptv's own `BootError`. */
export function defaultBootErrorPath(): string {
  return path.join(adaptvSrcDir(), "components", "boot-error.tsx")
}

/**
 * Force **one** React into the bundle. → `DECISIONS.md B31`
 *
 * Without this, `react` resolves relative to whichever file imported it: the app's
 * own screen finds the app's copy, while adaptv's components find adaptv's. Two
 * instances means the hook dispatcher one of them reads is `null`, and the render
 * dies on `Cannot read properties of null (reading 'useRef')`.
 *
 * It survived every unit test because those pass adaptv's own root as `appRoot`,
 * where there is only one copy to find. It failed on the first real app build —
 * which is exactly what the loud warning on a failed prerender is for.
 *
 * `createRequire` rooted at the app, so the copy that wins is the one the app
 * actually ships, and subpaths (`react/jsx-runtime`, `react-dom/server`) resolve
 * through the package's own exports map rather than by string surgery.
 */
function singleReactInstance(appRoot: string): EsbuildPlugin {
  const requireFromApp = createRequire(
    path.join(appRoot, "adaptv-boot-fallback.cjs"),
  )
  return {
    name: "adaptv-single-react-instance",
    setup(build) {
      build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => {
        try {
          return { path: requireFromApp.resolve(args.path) }
        } catch {
          //let esbuild's own resolution try — a missing React is a different
          //error, and a clearer one, than anything this could invent
          return null
        }
      })
    },
  }
}

/**
 * Stylesheets and binary assets are Vite's business, not esbuild's. The component
 * only needs its *markup* here — its Tailwind is already in the app stylesheet —
 * so an imported `.css` becomes an empty module instead of a parse error.
 */
const stubNonCodeImports: EsbuildPlugin = {
  name: "adaptv-stub-non-code-imports",
  setup(build) {
    const filter =
      /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|woff2?)(\?.*)?$/
    build.onResolve({ filter }, (args) => ({
      path: args.path,
      namespace: "adaptv-stub",
    }))
    build.onLoad({ filter: /.*/, namespace: "adaptv-stub" }, () => ({
      contents: "export default {}",
      loader: "js",
    }))
  },
}

export type PrerenderBootFallbackOptions = {
  appRoot: string
  /**
   * The `bootErrorScreen` specifier from `adaptv.config.ts`, exactly as written
   * (`"@/components/boot-error"`). `null` uses adaptv's own default.
   */
  specifier: string | null
}

/**
 * @returns the component's static HTML, once per boot code.
 * @throws if the component cannot be bundled or rendered — the caller decides
 *   whether that is fatal. It is not: an app should still ship without its boot
 *   fallback, loudly.
 */
export async function prerenderBootFallback({
  appRoot,
  specifier,
}: PrerenderBootFallbackOptions): Promise<Record<BootCode, string>> {
  const target = specifier ?? defaultBootErrorPath()
  //a consumer screen thunk resolves to a module's `default` (that is the
  //`ScreenThunk` contract); adaptv's own component is a named export, because it
  //also ships on the public component surface.
  const importClause = specifier
    ? "Component"
    : "{ BootError as Component }"

  //Once per boot code, because `code` is a PROP — that is the only shape an app
  //can branch on in JSX, and static markup cannot be handed a prop when it is
  //revealed. A component that ignores `code` yields four identical strings, which
  //`getBootFallbackMarkup` collapses back to one. No `error`/`reset`: a failed
  //boot has no error object to describe and nothing to reset to.
  const renders = Object.values(BOOT_CODES)
    .map(
      (code) =>
        `  ${JSON.stringify(code)}: renderToStaticMarkup(createElement(Component, { code: ${JSON.stringify(code)} })),`,
    )
    .join("\n")

  const entry = [
    `import { createElement } from "react"`,
    `import { renderToStaticMarkup } from "react-dom/server"`,
    `import ${importClause} from ${JSON.stringify(target)}`,
    `export const html = {`,
    renders,
    `}`,
  ].join("\n")

  const result = await esbuild({
    stdin: {
      contents: entry,
      resolveDir: appRoot,
      loader: "tsx",
      sourcefile: "adaptv-boot-fallback-entry.tsx",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    jsx: "automatic",
    //`@/…` is the app-side alias adaptv already assumes elsewhere (`toAppAlias`
    //in root-route-module.ts turns `./src/x` into `@/x`), so honour it here too.
    alias: { "@": path.join(appRoot, "src") },
    define: {
      //a build-time render is a production render: no dev-only trace panel, and
      //React's own production paths
      "import.meta.env.DEV": "false",
      "import.meta.env.PROD": "true",
      "import.meta.env.SSR": "true",
      "import.meta.env.MODE": '"production"',
      "process.env.NODE_ENV": '"production"',
    },
    plugins: [singleReactInstance(appRoot), stubNonCodeImports],
    //`react-dom/server` is CJS, and esbuild's CJS interop emits a `require`
    //call. There is no `require` in an ES module, and none can be derived from a
    //`data:` URL — `createRequire` needs a real path to resolve from. So one is
    //built here, rooted at the app, which is also exactly where React should be
    //resolved from. Without this the bundle dies on `Dynamic require of "util"`.
    banner: {
      js:
        `import { createRequire as __adaptvCreateRequire } from "node:module";` +
        `const require = __adaptvCreateRequire(${JSON.stringify(
          path.join(appRoot, "adaptv-boot-fallback.cjs"),
        )});`,
    },
    logLevel: "silent",
  })

  const output = result.outputFiles?.[0]
  if (!output) throw new Error("esbuild produced no output")

  const url = `data:text/javascript;base64,${Buffer.from(output.text).toString("base64")}`
  const module = (await import(url)) as {
    html?: Partial<Record<BootCode, unknown>>
  }

  const byCode = {} as Record<BootCode, string>
  for (const code of Object.values(BOOT_CODES)) {
    const html = module.html?.[code]
    if (typeof html !== "string" || html.length === 0) {
      throw new Error(
        `the error component rendered nothing for ${code} — it must return markup given only a \`code\``,
      )
    }
    byCode[code] = html
  }
  return byCode
}
