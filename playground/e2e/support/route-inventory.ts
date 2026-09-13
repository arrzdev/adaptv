import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import ts from "typescript"

/*
 * The static half of `lab-inventory.spec.ts`: which routes the app declares, and
 * which of them some spec actually navigates to.
 *
 * Both sides are read with the TypeScript parser rather than a regex over the text,
 * because the honest answer depends on structure a regex cannot see. A route path
 * written in `link.spec.ts` as the expected `href` of a link is not a visit; a
 * `page.goto(route)` inside `for (const [route, title] of PAGES)` is one visit per
 * row of `PAGES`, and the literal is nowhere near the call.
 */

/** A route the app declares, with the full path its nesting adds up to. */
export interface DeclaredRoute {
  path: string
  /** Matches a concrete visited path against the route's params and splats. */
  matcher: RegExp
}

/** One navigation a spec performs, where it was found, and the path it resolves to. */
export interface Visit {
  path: string
  where: string
}

/** A navigation whose target could not be resolved to a literal path. */
export interface Unresolved {
  call: string
  where: string
}

/*
 * ── the route config ────────────────────────────────────────────────────────────
 *
 * `rootRoute`, `layout`, `index` and `route` are TanStack's virtual-file-routes DSL
 * passed through by adaptv (`src/routes/adaptv-routes.ts`). Their path semantics:
 * `index` is the parent's own path, `route(path, …)` appends `path` to the parent's,
 * and `layout` is pathless. `physical()` mounts a directory of file routes whose
 * paths are not in the config at all, so it is refused rather than guessed at.
 */
export function readDeclaredRoutes(configFile: string): DeclaredRoute[] {
  return declaredRoutes(parse(configFile))
}

/** {@link readDeclaredRoutes} over a parsed source — the seam the guard's self-test uses. */
export function declaredRoutes(source: ts.SourceFile): DeclaredRoute[] {
  const paths = new Set<string>()

  function walk(node: ts.Node, prefix: string) {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
      ts.forEachChild(node, (child) => walk(child, prefix))
      return
    }
    const [first] = node.arguments
    const children = node.arguments.find(ts.isArrayLiteralExpression)
    const descend = (base: string) => {
      for (const child of children?.elements ?? []) walk(child, base)
    }

    switch (node.expression.text) {
      case "rootRoute":
      case "layout":
        descend(prefix)
        return
      case "index":
        paths.add(normalizePath(prefix || "/"))
        return
      case "route": {
        if (!first || !ts.isStringLiteralLike(first)) {
          throw new Error(
            `${where(source, node)}: route() without a literal path — extend readDeclaredRoutes`,
          )
        }
        const full = joinPaths(prefix, first.text)
        //a route with a component is a page; one that only groups children is not
        if (
          node.arguments.some(
            (arg, i) => i > 0 && ts.isStringLiteralLike(arg),
          )
        )
          paths.add(full)
        descend(full)
        return
      }
      case "physical":
        throw new Error(
          `${where(source, node)}: physical() mounts routes this guard cannot list from the config — extend readDeclaredRoutes`,
        )
      default:
        ts.forEachChild(node, (child) => walk(child, prefix))
    }
  }

  walk(source, "")
  return [...paths]
    .sort()
    .map((path) => ({ path, matcher: matcherFor(path) }))
}

function joinPaths(prefix: string, path: string): string {
  return normalizePath(
    `${prefix.replace(/\/$/, "")}/${path.replace(/^\//, "")}`,
  )
}

/** TanStack segments: `$param` is one segment, a bare `$` is a splat, `{-$param}` is optional. */
function matcherFor(path: string): RegExp {
  if (path === "/") return /^\/$/
  const body = path
    .split("/")
    .slice(1)
    .map((segment) => {
      if (segment === "$") return "(?:/.*)?"
      if (/^\{-\$\w+\}$/.test(segment)) return "(?:/[^/]+)?"
      if (segment.startsWith("$")) return "/[^/]+"
      return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
    })
    .join("")
  return new RegExp(`^${body}$`)
}

/** Drop the query, the hash and a trailing slash, so `/lab/x/?a#b` is `/lab/x`. */
export function normalizePath(path: string): string {
  const bare = path.replace(/[?#].*$/, "")
  return bare.length > 1 ? bare.replace(/\/+$/, "") : bare
}

/*
 * ── the specs ───────────────────────────────────────────────────────────────────
 *
 * A visit is one of two things, and nothing else:
 *
 *   1. A call to a navigation function — anything named `goto…` or `navigate…`, so
 *      `page.goto`, `tab.goto`, `gotoInstalled(page, p)` and
 *      `navigateInIsolation(page, p)` — with an argument that resolves to a path.
 *   2. A `toHaveURL(/regex/)` whose regex matches exactly one declared route. It is
 *      how a spec proves a link click landed, and a click is how `/lab` is reached.
 *      A regex that matches several routes proves none of them, so it counts for none.
 *
 * An argument resolves when it is a literal, a `const` bound to a literal, or the
 * loop variable of a `for…of` over an array literal (each row, destructured at the
 * same position). A function parameter does not resolve — its callers carry the
 * literal, and they are counted where they are. Mentions of a path anywhere else
 * (an expected `href`, a log row, a comment) are not visits.
 */
export function readVisits(
  playgroundRoot: string,
  dirs: string[],
  routes: DeclaredRoute[],
): { visits: Visit[]; unresolved: Unresolved[] } {
  const visits: Visit[] = []
  const unresolved: Unresolved[] = []

  for (const dir of dirs) {
    for (const file of listTs(join(playgroundRoot, dir))) {
      const found = specVisits(
        parse(file),
        relative(playgroundRoot, file),
        routes,
      )
      visits.push(...found.visits)
      unresolved.push(...found.unresolved)
    }
  }
  return { visits, unresolved }
}

/** {@link readVisits} over one parsed spec — the seam the guard's self-test uses. */
export function specVisits(
  source: ts.SourceFile,
  name: string,
  routes: DeclaredRoute[],
): { visits: Visit[]; unresolved: Unresolved[] } {
  const visits: Visit[] = []
  const unresolved: Unresolved[] = []
  const label = (node: ts.Node) => {
    const { line } = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    )
    return `${name}:${line + 1}`
  }

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const target = navigationTarget(node)
      if (target) {
        const strings = resolveStrings(target)
        if (strings === null)
          unresolved.push({
            call: node.getText(source).split("\n")[0],
            where: label(node),
          })
        else
          for (const text of strings)
            if (text.startsWith("/"))
              visits.push({
                path: normalizePath(text),
                where: label(node),
              })
      }
      if (calleeName(node) === "toHaveURL") {
        const [arg] = node.arguments
        if (arg && ts.isRegularExpressionLiteral(arg)) {
          const regex = regexFromLiteral(arg.text)
          const hits = routes.filter(({ path }) => regex.test(path))
          if (hits.length === 1)
            visits.push({ path: hits[0].path, where: label(node) })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { visits, unresolved }
}

function listTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return listTs(full)
    return entry.name.endsWith(".ts") ? [full] : []
  })
}

function parse(file: string): ts.SourceFile {
  return parseSource(file, readFileSync(file, "utf8"))
}

/** Parse TypeScript text as a source file named `name`. */
export function parseSource(name: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    name,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
}

function where(source: ts.SourceFile, node: ts.Node): string {
  const { line } = source.getLineAndCharacterOfPosition(
    node.getStart(source),
  )
  return `${source.fileName}:${line + 1}`
}

/**
 * The argument a navigation call navigates to. A method (`page.goto(p, opts)`)
 * takes it first; a helper (`gotoInstalled(page, p)`) takes the page first and the
 * path second. Anything not named `goto…`/`navigate…` is not a navigation.
 */
function navigationTarget(call: ts.CallExpression): ts.Expression | null {
  const name = calleeName(call)
  if (!name || !/^(goto|navigate)/i.test(name)) return null
  const index =
    ts.isPropertyAccessExpression(call.expression) ||
    call.arguments.length < 2
      ? 0
      : 1
  return call.arguments[index] ?? null
}

function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression
  if (ts.isIdentifier(callee)) return callee.text
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text
  return null
}

function regexFromLiteral(text: string): RegExp {
  const end = text.lastIndexOf("/")
  return new RegExp(text.slice(1, end), text.slice(end + 1))
}

function unwrap(node: ts.Expression): ts.Expression {
  let current = node
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  )
    current = current.expression
  return current
}

/** Every string an expression can statically be, or `null` when it cannot be known. */
function resolveStrings(expression: ts.Expression): string[] | null {
  const node = unwrap(expression)
  if (ts.isStringLiteralLike(node)) return [node.text]
  if (ts.isConditionalExpression(node)) {
    const a = resolveStrings(node.whenTrue)
    const b = resolveStrings(node.whenFalse)
    return a && b ? [...a, ...b] : null
  }
  if (ts.isIdentifier(node)) return resolveIdentifier(node)
  return null
}

function resolveIdentifier(id: ts.Identifier): string[] | null {
  for (
    let scope: ts.Node | undefined = id.parent;
    scope;
    scope = scope.parent
  ) {
    if (
      ts.isFunctionLike(scope) &&
      scope.parameters.some((p) => bindsName(p.name, id.text))
    )
      return null
    if (
      ts.isForOfStatement(scope) &&
      ts.isVariableDeclarationList(scope.initializer)
    ) {
      const [declaration] = scope.initializer.declarations
      const position = positionIn(declaration.name, id.text)
      if (position === undefined) continue
      const rows = arrayElements(scope.expression)
      if (!rows) return null
      const out: string[] = []
      for (const row of rows) {
        const cell = position === -1 ? row : arrayElements(row)?.[position]
        const strings = cell && resolveStrings(cell)
        if (!strings) return null
        out.push(...strings)
      }
      return out
    }
    if (!(ts.isBlock(scope) || ts.isSourceFile(scope))) continue
    const own = topLevelConst(scope.statements, id.text)
    if (own !== undefined) return own && resolveStrings(own)
    if (ts.isSourceFile(scope)) {
      const imported = importedConst(scope, id.text)
      return imported && resolveStrings(imported)
    }
  }
  return null
}

/**
 * The initializer of the `const` an identifier names: the nearest enclosing block
 * that declares it, or a top-level `export const` in a relative module it was
 * imported from. `null` for a function parameter, a `let`, or anything else.
 */
function constInitializer(id: ts.Identifier): ts.Expression | null {
  for (
    let scope: ts.Node | undefined = id.parent;
    scope;
    scope = scope.parent
  ) {
    if (
      ts.isFunctionLike(scope) &&
      scope.parameters.some((p) => bindsName(p.name, id.text))
    )
      return null
    if (!(ts.isBlock(scope) || ts.isSourceFile(scope))) continue
    const own = topLevelConst(scope.statements, id.text)
    if (own !== undefined) return own
    if (ts.isSourceFile(scope)) return importedConst(scope, id.text)
  }
  return null
}

function topLevelConst(
  statements: ts.NodeArray<ts.Statement>,
  name: string,
): ts.Expression | null | undefined {
  for (const statement of statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        declaration.name.text !== name
      )
        continue
      const isConst = statement.declarationList.flags & ts.NodeFlags.Const
      return isConst ? (declaration.initializer ?? null) : null
    }
  }
  return undefined
}

function importedConst(
  source: ts.SourceFile,
  name: string,
): ts.Expression | null {
  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith(".")
    )
      continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    const specifier = bindings.elements.find((e) => e.name.text === name)
    if (!specifier) continue
    const exported = (specifier.propertyName ?? specifier.name).text
    const base = resolve(
      dirname(source.fileName),
      statement.moduleSpecifier.text,
    )
    const file = [`${base}.ts`, join(base, "index.ts")].find(existsSync)
    if (!file) return null
    return topLevelConst(parse(file).statements, exported) ?? null
  }
  return null
}

/** -1 when the binding IS the name, the index when it destructures to it, else undefined. */
function positionIn(
  name: ts.BindingName,
  text: string,
): number | undefined {
  if (ts.isIdentifier(name)) return name.text === text ? -1 : undefined
  if (ts.isArrayBindingPattern(name)) {
    const index = name.elements.findIndex(
      (element) =>
        ts.isBindingElement(element) &&
        ts.isIdentifier(element.name) &&
        element.name.text === text,
    )
    return index === -1 ? undefined : index
  }
  return undefined
}

function bindsName(name: ts.BindingName, text: string): boolean {
  if (ts.isIdentifier(name)) return name.text === text
  return name.elements.some(
    (element) =>
      ts.isBindingElement(element) && bindsName(element.name, text),
  )
}

/** The elements of an array literal, following a `const` identifier to one. */
function arrayElements(expression: ts.Expression): ts.Expression[] | null {
  const node = unwrap(expression)
  if (ts.isArrayLiteralExpression(node)) return [...node.elements]
  if (!ts.isIdentifier(node)) return null
  const initializer = constInitializer(node)
  return initializer ? arrayElements(initializer) : null
}
