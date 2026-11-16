import { dirname, join, resolve } from "node:path"
import ts from "typescript"
import { describe, expect, it, vi } from "vitest"
import type { Block } from "@/content/blocks"
import { ALL_DOCS } from "@/content/docs"
import { allExportedNames } from "./adaptv-exports"

//the real pages import their demos, and a demo imports the runtime; this test reads
//only the strings of a page, so empty modules are enough
vi.mock("adaptv/components", () => ({}))
vi.mock("adaptv/hooks", () => ({}))
vi.mock("adaptv/storage", () => ({}))
vi.mock("@/assets/captures/ios-list.png?adaptv-image", () => ({ default: {} }))

//Every TypeScript sample on the docs pages is typechecked against the built package
//(`adaptv` links `..`, whose `exports` point at `dist/*.d.mts`), the way a reader's
//editor would. imports.test.ts checks the import lines; this checks the code under
//them: a prop that was renamed, a hook whose return changed, a wrong argument.
//
//A sample is a fragment more often than a file, so some leniency is built in and kept
//small: a sample with no import at all gets the adaptv imports it uses, statements and
//JSX with no component around them are put in one, and a name the sample never declares
//and adaptv does not export is a placeholder (`rows`, `Title`). A fragment that still
//cannot compile sets `partial: true` on its block and is skipped: a route file (the ids
//`createFileRoute` accepts come from the app's generated route tree, which a docs page
//does not have), a service worker (it needs the worker's types) or a snippet cut mid-tag.
//Needs `pnpm build` at the root first, like every website test.

type Sample = { id: string; ext: "ts" | "tsx"; code: string }

/** The `ts`/`tsx` code blocks and demo sources of a page that are not marked partial. */
function samples(slug: string, blocks: Block[]): Sample[] {
  const found: Sample[] = []
  blocks.forEach((block, index) => {
    if (block.type !== "code" && block.type !== "demo") return
    if (block.partial === true || block.code === undefined) return
    const lang = block.lang ?? "tsx"
    if (lang !== "ts" && lang !== "tsx") return
    found.push({ id: `${slug}-${index}`, ext: lang, code: block.code })
  })
  return found
}

const SAMPLES = ALL_DOCS.flatMap((page) => samples(page.slug, page.blocks))

//adaptv's names, each with the subpath a reader imports it from: the barrels a page
//documents come before the ones that re-export for the framework's own use
const PREFERRED = [
  "components",
  "hooks",
  "capabilities",
  "storage",
  "router",
  "utils",
  "config",
]
const rank = (subpath: string) =>
  PREFERRED.includes(subpath) ? PREFERRED.indexOf(subpath) : PREFERRED.length
const ADAPTV_NAMES = new Map<string, string>()
for (const [subpath, names] of allExportedNames().sort(
  ([a], [b]) => rank(a) - rank(b),
))
  for (const name of names)
    if (name !== "default" && !ADAPTV_NAMES.has(name))
      ADAPTV_NAMES.set(name, subpath)

/**
 * The names a sample declares at its top level (column 0). A line scan, not the syntax
 * tree: a fragment such as `useX()` then bare JSX does not parse, and the tree is wrong.
 */
function declaredNames(code: string): Set<string> {
  const names = new Set<string>()
  for (const [, binding, name] of code.matchAll(
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:(?:const|let|var)\s+([{[][^=]*)|(?:function\*?|class|type|interface|enum|const|let|var)\s+([\w$]+))/gm,
  )) {
    if (name !== undefined) names.add(name)
    for (const [word] of (binding ?? "").matchAll(/[\w$]+/g)) names.add(word)
  }
  return names
}

/**
 * `import { … } from "adaptv/<subpath>"` for each adaptv name the code mentions. A word
 * scan, not the syntax tree: a fragment such as `useX()` then bare JSX does not parse.
 * An import the code does not use is harmless.
 */
function adaptvImports(code: string, declared: Set<string>): string {
  const bySubpath = new Map<string, Set<string>>()
  for (const [word] of code.matchAll(/[\w$]+/g)) {
    const subpath = ADAPTV_NAMES.get(word)
    if (subpath !== undefined && !declared.has(word))
      bySubpath.set(subpath, (bySubpath.get(subpath) ?? new Set()).add(word))
  }
  return [...bySubpath]
    .map(
      ([subpath, names]) =>
        `import { ${[...names].join(", ")} } from "adaptv/${subpath}"\n`,
    )
    .join("")
}

/**
 * The file a sample is checked as. The imports stay at the top. What follows is put in
 * a component when it has JSX with no component around it, or a `return` with no
 * function around it. A file with no import or export would share one global scope with
 * the others, so it is made a module.
 */
function asModule(sample: Sample): string {
  const { ext } = sample
  //`defineApp` wants the whole config and a sample shows a key or two of it; the spread
  //supplies the rest and leaves the keys the sample writes to be checked
  const code = sample.code.replace(
    /\bdefineApp\(\{/g,
    "defineApp({ ...({} as Parameters<typeof defineApp>[0]),",
  )
  const source = ts.createSourceFile(
    `x.${ext}`,
    code,
    ts.ScriptTarget.ES2022,
    true,
  )
  const imports = source.statements.filter(ts.isImportDeclaration)
  const head =
    imports.length === 0 ? adaptvImports(code, declaredNames(code)) : ""
  const importsEnd = imports.at(-1)?.end ?? 0
  const body = code.slice(importsEnd)
  const jsx = ext === "tsx" ? body.search(/^</m) : -1
  if (jsx !== -1)
    return `${head}${code.slice(0, importsEnd)}\nexport function __Sample() {${body.slice(0, jsx)}\nreturn (<>\n${body.slice(jsx)}\n</>)\n}\n`
  if (/^(?:if\b.*\s)?return\b/m.test(body))
    return `${head}${code.slice(0, importsEnd)}\nexport function __Sample() {${body}\n}\n`
  const isModule =
    imports.length > 0 ||
    source.statements.some(
      (node) =>
        ts.isExportDeclaration(node) ||
        ts.isExportAssignment(node) ||
        (ts.canHaveModifiers(node) &&
          ts
            .getModifiers(node)
            ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)),
    )
  return `${head}${code}${isModule || head !== "" ? "" : "\nexport {}\n"}`
}

//the website's own compiler options, so a sample sees the same `react` types and `jsx`
//setting as the site; unused names are normal in a sample
const configPath = resolve("tsconfig.json")
const config = ts.parseJsonConfigFileContent(
  ts.readConfigFile(configPath, ts.sys.readFile).config,
  ts.sys,
  dirname(configPath),
)
const options: ts.CompilerOptions = {
  ...config.options,
  noUnusedLocals: false,
  noUnusedParameters: false,
  noEmit: true,
  types: ["node"],
}

//Samples live as virtual files in a folder under website/, so `adaptv` and `react`
//resolve from website/node_modules.
const VIRTUAL_DIR = resolve(".docs-samples")
const virtualPath = ({ id, ext }: Sample) => join(VIRTUAL_DIR, `${id}.${ext}`)

//What a real app has and a sample may lean on: the ambient `createFileRoute`.
const PRELUDE = join(VIRTUAL_DIR, "prelude.d.ts")
const files = new Map<string, string>([
  [
    PRELUDE,
    `/// <reference types="adaptv/route-globals" />
import type { AdaptvRouter } from "adaptv/router"
declare module "adaptv/router" {
  interface Register {
    router: AdaptvRouter
  }
}
`,
  ],
])
for (const sample of SAMPLES) files.set(virtualPath(sample), asModule(sample))

const host = ts.createCompilerHost(options)
const { fileExists, readFile, getSourceFile } = host
host.fileExists = (path) => files.has(path) || fileExists(path)
host.readFile = (path) => files.get(path) ?? readFile(path)
host.getSourceFile = (path, languageVersion, ...rest) => {
  const text = files.get(path)
  return text === undefined
    ? getSourceFile(path, languageVersion, ...rest)
    : ts.createSourceFile(path, text, languageVersion, true)
}

const program = ts.createProgram([...files.keys()], options, host)

//Not mistakes in a fragment: a name it never declares (2304, 2552) when adaptv does not
//export it, what that makes implicit any (7005, 7006, 7031), and the app's own modules.
function isPlaceholder(diagnostic: ts.Diagnostic): boolean {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
  const quoted = /'([^']+)'/.exec(message)?.[1] ?? ""
  if ([2304, 2552, 18004].includes(diagnostic.code))
    return !ADAPTV_NAMES.has(quoted)
  if (diagnostic.code === 2307) return /^(@\/|\.)/.test(quoted)
  return [7005, 7006, 7031].includes(diagnostic.code)
}

/** What the compiler says about one sample, one line each, with its position. */
function problems(sample: Sample): string[] {
  const file = program.getSourceFile(virtualPath(sample))
  if (file === undefined) return ["the sample was not compiled"]
  return [
    ...program.getSyntacticDiagnostics(file),
    ...program.getSemanticDiagnostics(file),
  ]
    .filter((diagnostic) => !isPlaceholder(diagnostic))
    .map((diagnostic) => {
      const { line } = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0)
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        "\n",
      )
      return `line ${line + 1}: TS${diagnostic.code} ${message}`
    })
}

describe("samples", () => {
  it("skips a block marked partial and a bash one", () => {
    const blocks: Block[] = [
      { type: "code", label: "a.ts", lang: "ts", code: "const a: number = 1" },
      { type: "code", label: "b.ts", lang: "ts", code: "oops", partial: true },
      { type: "code", label: "sh", lang: "bash", code: "pnpm dev" },
    ]
    expect(samples("x", blocks).map((sample) => sample.id)).toEqual(["x-0"])
  })

  it("imports what a sample with no import uses, and wraps bare JSX", () => {
    const code = `const { info } = useDevice()\n\n<Text>{info?.os}</Text>`
    const file = asModule({ id: "x", ext: "tsx", code })
    expect(file).toMatch(
      /import \{ [^}]*\bText\b[^}]* \} from "adaptv\/components"/,
    )
    expect(file).toContain(`import { useDevice } from "adaptv/hooks"`)
    expect(file).toContain("export function __Sample() {")
  })

  it("is caught when a sample does not typecheck", () => {
    const sample: Sample = {
      id: "made-up",
      ext: "tsx",
      code: `import { Button } from "adaptv/components"\nexport const a = <Button notAProp="x">Go</Button>`,
    }
    files.set(virtualPath(sample), asModule(sample))
    const check = ts.createProgram([virtualPath(sample)], options, host)
    const file = check.getSourceFile(virtualPath(sample))
    expect(file && check.getSemanticDiagnostics(file).length).toBeGreaterThan(0)
  })

  //`partial` is for what cannot compile, not for what is inconvenient to fix
  it("has few blocks marked partial", () => {
    const partial = ALL_DOCS.flatMap((page) => page.blocks).filter(
      (block) => "partial" in block && block.partial === true,
    )
    expect(partial.length).toBeLessThanOrEqual(12)
  })

  //a walker that stops finding blocks would pass every page below without checking anything
  it("finds the samples on the docs pages, about 120 of them", () => {
    expect(SAMPLES.length).toBeGreaterThan(100)
  })

  it.each(SAMPLES.map((sample) => [sample.id, sample] as const))(
    "%s typechecks",
    (_, sample) => {
      expect(problems(sample)).toEqual([])
    },
  )
})
