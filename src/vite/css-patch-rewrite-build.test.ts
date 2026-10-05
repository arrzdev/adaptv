// @vitest-environment node
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Plugin } from "vite"
import { afterAll, describe, expect, it, vi } from "vitest"
import {
  adaptvCssPatchRewritePlugin,
  findUnwrappedHover,
} from "#adaptv/vite/css-patch-rewrite.ts"

/*
 * The emitted stylesheet, grepped (patch-delivery.md §7): a real Vite build, because
 * only Vite can say whether a `transform` with no `enforce` still sees the CSS before
 * its own CSS stage takes it — the slot `tailwind-empty-fallback.ts` measured, where
 * either `enforce` makes the rewrite silently not happen while every unit test passes.
 */

const roots: string[] = []
afterAll(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

const APP_CSS = `.card { padding: 1rem }
.card:hover { background: #eef }
.tile:active { transform: scale(0.95) }
.row:hover .chevron, .row:focus-visible .chevron { opacity: 1 }
`

async function buildCss(plugins: Plugin[]): Promise<string> {
  const appRoot = mkdtempSync(
    path.join(tmpdir(), "adaptv-css-patch-build-"),
  )
  roots.push(appRoot)
  writeFileSync(path.join(appRoot, "app.css"), APP_CSS)
  //a dependency's stylesheet, imported the way an app imports a date picker's
  const picker = path.join(appRoot, "node_modules/picker")
  mkdirSync(picker, { recursive: true })
  cpSync(
    path.join(process.cwd(), "src/vite/fixtures/third-party-picker.css"),
    path.join(picker, "picker.css"),
  )
  writeFileSync(
    path.join(picker, "package.json"),
    JSON.stringify({ name: "picker", version: "1.0.0" }),
  )
  writeFileSync(
    path.join(appRoot, "main.js"),
    'import "./app.css"\nimport "picker/picker.css"\nexport const app = 1\n',
  )

  const { build } = await import("vite")
  await build({
    root: appRoot,
    configFile: false,
    logLevel: "silent",
    plugins,
    build: {
      outDir: "dist",
      rollupOptions: { input: path.join(appRoot, "main.js") },
    },
  })
  const assets = path.join(appRoot, "dist/assets")
  return readdirSync(assets)
    .filter((f) => f.endsWith(".css"))
    .map((f) => readFileSync(path.join(assets, f), "utf8"))
    .join("\n")
}

describe("the built stylesheet", () => {
  it("has hovers a tap can stick without the plugin — the check can fail", async () => {
    const css = await buildCss([])
    expect(findUnwrappedHover(css).length).toBeGreaterThan(0)
  }, 60_000)

  it("has zero unwrapped :hover with it, app and node_modules CSS alike", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    const css = await buildCss([adaptvCssPatchRewritePlugin()])
    expect(findUnwrappedHover(css)).toEqual([])
    //minified by Vite's CSS stage, after the rewrite
    expect(css).toContain("@media (hover:hover)")
    expect(css).toContain(".tile[data-pressed]")
    expect(css).toContain(".picker__day[data-pressed]")
    //L7: the rewrite is announced, with a count per patch
    expect(log).toHaveBeenCalledWith(
      "[adaptv] css patches: hover 7 rules (1 left as written), active 2 rules",
    )
    log.mockRestore()
  }, 60_000)
})
