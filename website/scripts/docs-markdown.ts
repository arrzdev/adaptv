/*
 * Writes `/llms.txt` and `/docs/<slug>.md` into the client build, next to the
 * prerendered pages, so the Worker serves them as static files. The text comes from
 * `src/content/docs/markdown.ts`; this file only loads the docs and emits the result.
 *
 * The docs are loaded with a bare Vite module runner, not the app's build: a page file
 * imports its demo component, and a demo pulls in the whole runtime (`virtual:adaptv/*`
 * modules only the adaptv plugin resolves). The markdown never renders a demo, so each
 * demo import is replaced with an empty component.
 */
import { readFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { type Plugin, runnerImport } from "vite"
import type { MarkdownFile } from "../src/content/docs/markdown"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const ENTRY = "virtual:docs-markdown"
const DEMO = "\0docs-demo:"

export function docsMarkdown(): Plugin[] {
  return [
    {
      name: "website:docs-markdown",
      apply: "build",
      applyToEnvironment: (environment) => environment.name === "client",
      async generateBundle() {
        const files = await loadMarkdownFiles()
        for (const file of files)
          this.emitFile({
            type: "asset",
            fileName: file.path,
            source: file.body,
          })
        if (process.env.NITRO_PRESET?.startsWith("cloudflare"))
          this.emitFile({
            type: "asset",
            fileName: "_headers",
            source: cloudflareHeaders(files),
          })
      },
    },
    {
      //`vite preview` hands the build to Nitro's preview server, which calls `.md`
      //application/octet-stream and gives `.txt` no charset: answer these files before it
      name: "website:docs-markdown-preview",
      enforce: "pre",
      configurePreviewServer(server) {
        //Nitro's public dir; the preview config's own `build.outDir` is not where the
        //build went
        const outDir = resolve(server.config.root, ".output/public")
        server.middlewares.use(async (req, res, next) => {
          const path = (req.url ?? "").split("?")[0].slice(1)
          const type = contentType(path)
          if (!type || (req.method !== "GET" && req.method !== "HEAD"))
            return next()
          const body = await readFile(join(outDir, path)).catch(() => null)
          if (!body) return next()
          res.writeHead(200, {
            "content-type": type,
            "content-length": body.length,
          })
          res.end(req.method === "HEAD" ? undefined : body)
        })
      },
    },
  ]
}

/** The type a generated file is served with, or null for any other path. */
function contentType(path: string) {
  //the value of LLMS_TXT_PATH: the config loader can't resolve that module's `@/` imports
  if (path === "llms.txt") return "text/plain; charset=utf-8"
  if (/^docs\/[a-z0-9-]+\.md$/.test(path)) return "text/markdown; charset=utf-8"
  return null
}

/*
 * Cloudflare's assets serve `.txt` as a bare `text/plain` (robots.txt in production),
 * with no charset. A `_headers` file in the assets directory sets the types; Nitro keeps
 * it and appends its own rules (`/assets/*` caching). One rule per file, not a splat:
 * the file takes 100 rules, and a docs path pattern would also match the HTML pages.
 */
function cloudflareHeaders(files: MarkdownFile[]) {
  return files
    .map((file) => `/${file.path}\n  Content-Type: ${contentType(file.path)}\n`)
    .join("")
}

export async function loadMarkdownFiles() {
  const { module } = await runnerImport<{ default: MarkdownFile[] }>(ENTRY, {
    root,
    configFile: false,
    logLevel: "warn",
    resolve: { tsconfigPaths: true },
    plugins: [
      {
        name: "website:docs-markdown-entry",
        enforce: "pre",
        resolveId(id) {
          if (id === ENTRY) return `\0${ENTRY}`
          if (id.startsWith("@/components/docs-demos/"))
            return `${DEMO}${basename(id)}`
        },
        load(id) {
          if (id === `\0${ENTRY}`)
            return [
              `import { DOCS } from "@/content/docs"`,
              `import { docsMarkdownFiles } from "@/content/docs/markdown"`,
              "export default docsMarkdownFiles(DOCS)",
            ].join("\n")
          //`switch-demo` → `export const SwitchDemo`, the one name its page imports
          if (id.startsWith(DEMO)) {
            const name = id
              .slice(DEMO.length)
              .replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase())
            return `export const ${name} = () => null`
          }
        },
      },
    ],
  })
  return module.default
}
