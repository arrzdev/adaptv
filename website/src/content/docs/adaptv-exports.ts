import { readFileSync } from "node:fs"
import ts from "typescript"

//What a reader gets is the built package, so the names come from the `.d.mts` each
//`exports` entry points at (paths relative to website/, vitest's cwd). The src barrels
//would need the framework's `#adaptv/*` paths to resolve, and could drift from what
//`exports` really ships. Needs `pnpm build` first, like every website test.
type ExportEntry = string | { types?: string; default?: string }
const exportsMap: Record<string, ExportEntry> = JSON.parse(
  readFileSync("../package.json", "utf8"),
).exports

const typesFile = (entry: ExportEntry) =>
  typeof entry === "string" ? entry : (entry.types ?? entry.default ?? "")

const declarationEntries = Object.entries(exportsMap).filter(([, entry]) =>
  /\.d\.m?ts$/.test(typesFile(entry)),
)
const program = ts.createProgram(
  declarationEntries.map(([, entry]) => `../${typesFile(entry)}`),
  { noEmit: true, skipLibCheck: true },
)
const checker = program.getTypeChecker()

/** The names a subpath exports, or undefined when `exports` has no such subpath. */
export function exportedNames(subpath: string): Set<string> | undefined {
  const entry = exportsMap[`./${subpath}`]
  if (entry === undefined) return undefined
  const file = typesFile(entry)
  const source = program.getSourceFile(`../${file}`)
  //a CSS or JSON subpath exists but has no names to import
  if (source === undefined) return new Set()
  const module = checker.getSymbolAtLocation(source)
  if (module === undefined) return new Set()
  return new Set(
    checker.getExportsOfModule(module).map((symbol) => symbol.name),
  )
}

/** Every `adaptv/<subpath>` that exports names, with the names. */
export function allExportedNames(): [string, Set<string>][] {
  return Object.keys(exportsMap)
    .map((key) => key.slice(2))
    .flatMap((subpath) => {
      const names = exportedNames(subpath)
      return names !== undefined && names.size > 0
        ? [[subpath, names] as [string, Set<string>]]
        : []
    })
}
