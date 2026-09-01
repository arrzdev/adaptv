/**
 * Reading `chromeTint` out of the app's route files, at build time.
 *
 * The option is declared where it belongs — on the route — but it is consumed as
 * SOURCE, not as a value: the colour has to be in the pre-paint script, which
 * runs before any route module has been evaluated. → `src/shell/route-tints.ts`
 *
 * That is why a `chromeTint` this cannot read statically is REFUSED rather than
 * quietly resolved to the theme colour: a computed tint would typecheck, run, and
 * do nothing on the one frame the option exists for — the same doctrine as
 * `thunk-specifiers.ts`, which will not guess at a non-literal import either. The
 * one shape that is passed over in silence is a spread in the options object; see
 * the note at that check for why complaining there would cost more than it buys.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { parseAst } from "vite"
import type { RouteTint } from "#adaptv/shell/route-tints.ts"
import {
  routeIdToPath,
  sortRouteTints,
} from "#adaptv/shell/route-tints.ts"

/** The route factories a route file can be declared with. */
const FACTORIES = new Set(["createFileRoute", "createLazyFileRoute"])
const ROUTE_FILE = /\.(?:tsx|ts|jsx|js)$/
/** Directories a route tree never has anything in. */
const SKIP_DIR = new Set(["node_modules", ".adaptv", ".tanstack"])

/**
 * Every file under `dir` that could hold a route. Cheap enough to run on every
 * build — the expensive part (parsing) is gated on the substring below.
 */
function routeFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    //no routes directory is not an error here; the router plugin already fails
    //loudly on that, and this must not be the thing that reports it
    return []
  }
  const found: string[] = []
  for (const entry of entries) {
    if (SKIP_DIR.has(entry)) continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...routeFiles(full))
    else if (ROUTE_FILE.test(entry)) found.push(full)
  }
  return found
}

type Node = { type?: string; [key: string]: unknown }

/** Depth-first over every node in an ESTree-shaped AST. */
function walk(node: unknown, visit: (node: Node) => void): void {
  if (!node || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  const candidate = node as Node
  if (typeof candidate.type === "string") visit(candidate)
  for (const key of Object.keys(candidate)) {
    if (key === "type") continue
    walk(candidate[key], visit)
  }
}

/** A property's name, whether it was written bare or quoted. */
function propertyName(property: Node): string | null {
  const key = property.key as Node | undefined
  if (!key) return null
  if (property.computed) return null
  if (key.type === "Identifier") return key.name as string
  if (key.type === "Literal" && typeof key.value === "string")
    return key.value
  return null
}

/**
 * `createFileRoute("<id>")({ … })` — the curried form adaptv's route generator
 * writes. Returns the id and the options object, or null for any other call.
 */
function routeCall(
  node: Node,
): { id: string; options: Node | null } | null {
  if (node.type !== "CallExpression") return null
  const callee = node.callee as Node | undefined
  if (!callee || callee.type !== "CallExpression") return null
  const factory = callee.callee as Node | undefined
  if (
    !factory ||
    factory.type !== "Identifier" ||
    !FACTORIES.has(factory.name as string)
  )
    return null
  const idArg = (callee.arguments as Node[] | undefined)?.[0]
  if (
    !idArg ||
    idArg.type !== "Literal" ||
    typeof idArg.value !== "string"
  )
    return null
  const optionsArg = (node.arguments as Node[] | undefined)?.[0] ?? null
  return { id: idArg.value, options: optionsArg }
}

/**
 * The declared tint, or null when the route declares none.
 *
 * Throws — naming the file and the fix — when `chromeTint` is present but not a
 * literal string. See the module note: silently ignoring it would produce
 * exactly the flash the option exists to remove.
 */
function tintFromOptions(
  options: Node | null,
  constants: Map<string, string>,
  file: string,
): string | null {
  if (!options) return null
  if (options.type !== "ObjectExpression") return null
  for (const property of (options.properties as Node[]) ?? []) {
    //A spread could carry a tint this cannot see, but complaining about every
    //spread would make a common, innocent shape unusable. It is left alone.
    if (property.type !== "Property") continue
    if (propertyName(property) !== "chromeTint") continue
    const value = property.value as Node
    if (value.type === "Literal" && typeof value.value === "string")
      return value.value
    //`chromeTint: TINT`, where `TINT` is a top-level `const` string in this same
    //file. Naming the colour is the first thing anyone does — the page that shows
    //it needs the value too — and a binding this file declares is every bit as
    //static as the literal it holds.
    if (value.type === "Identifier") {
      const resolved = constants.get(value.name as string)
      if (resolved !== undefined) return resolved
    }
    throw new Error(
      `[adaptv] chromeTint must be a literal colour string in ${file} — either written inline or held by a top-level const in the same file. It is read from the source at build time so the colour is on screen before the app boots; a computed value would typecheck and then do nothing on the one frame it exists for.`,
    )
  }
  return null
}

/**
 * Top-level `const NAME = "literal"` bindings, so `chromeTint: NAME` can be
 * resolved. Only the module's own top level, and only string literals — anything
 * further and this stops being a scan and starts being an interpreter.
 */
function topLevelStringConstants(program: Node): Map<string, string> {
  const constants = new Map<string, string>()
  for (const statement of (program.body as Node[]) ?? []) {
    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? (statement.declaration as Node | null)
        : statement
    if (
      !declaration ||
      declaration.type !== "VariableDeclaration" ||
      declaration.kind !== "const"
    )
      continue
    for (const declarator of (declaration.declarations as Node[]) ?? []) {
      const id = declarator.id as Node
      const init = declarator.init as Node | null
      if (id?.type !== "Identifier") continue
      if (init?.type === "Literal" && typeof init.value === "string")
        constants.set(id.name as string, init.value)
    }
  }
  return constants
}

/** Every `chromeTint` declared in one file. */
export function routeTintsInSource(
  source: string,
  file: string,
): RouteTint[] {
  //the parse is the only expensive part, and almost no route file declares a
  //tint — so ask the cheap question first
  if (!source.includes("chromeTint")) return []
  let ast: unknown
  try {
    ast = parseAst(source, { lang: "tsx" })
  } catch (error) {
    throw new Error(
      `[adaptv] could not read the routes in ${file} while collecting chromeTint: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }
  const constants = topLevelStringConstants(ast as Node)
  const found: RouteTint[] = []
  walk(ast, (node) => {
    const call = routeCall(node)
    if (!call) return
    const tint = tintFromOptions(call.options, constants, file)
    if (tint === null) return
    found.push({
      id: call.id,
      path: routeIdToPath(call.id),
      tint,
    })
  })
  return found
}

/**
 * The whole app's route→tint table, ordered most specific first.
 *
 * `routesDir` is the resolved routes directory (adaptv resolves
 * `router.routesDirectory` against `src/`, not the app root — see
 * `adaptv-plugin.ts`).
 */
export function collectRouteTints(routesDir: string): RouteTint[] {
  const found: RouteTint[] = []
  for (const file of routeFiles(routesDir)) {
    found.push(...routeTintsInSource(readFileSync(file, "utf8"), file))
  }
  return sortRouteTints(found)
}
