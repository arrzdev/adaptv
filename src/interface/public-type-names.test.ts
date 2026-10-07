// @vitest-environment node
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

//What a developer reads when they hover adaptv's API or hit a type error in it. Where
//a type is adaptv's to name, it names adaptv: an engine name in a hover is the engine
//showing through the facade. → docs/decisions/facade-and-opacity.md §1
//
//Measured with the compiler itself, the way an editor's hover is: a consumer module
//imports the barrels by their public specifiers, and each probe below is the printed
//type of one name. An adaptv alias of an engine type does NOT pass this, because
//TypeScript prints an alias by the type it aliases; that is why the names below are
//interfaces.
//
//Not covered, on purpose: the router-generic hooks (`useRouter`, `useNavigate`,
//`useParams`, `createFileRoute`, …) and the interfaces the generated route tree
//augments by name (`Register`, `FileRoutesByPath`, …). Their signatures are the
//engine's own generics, and a wrapper type would collapse their inference.

const repo = fileURLToPath(new URL("../..", import.meta.url))
//Not on disk: the compiler host below serves these, so the root typecheck never sees
//a second route tree or a second `Register` augmentation.
const fixtures = path.join(repo, "__public-type-names__")
const probeFile = path.join(fixtures, "probe.ts")
const treeFile = path.join(fixtures, "routeTree.gen.ts")

//A two-route tree in the shape the generator writes, after adaptv's rewrite of its
//specifiers. → src/vite/route-tree-opacity.ts
const files: Record<string, string> = {
  [path.join(fixtures, "home.page.ts")]: `
import { createFileRoute } from "@arrzdev/adaptv/router"
export const Route = createFileRoute("/")({ component: () => null })
`,
  [path.join(fixtures, "post.page.ts")]: `
import { createFileRoute } from "@arrzdev/adaptv/router"
export const Route = createFileRoute("/posts/$id")({ component: () => null })
`,
  [treeFile]: `
// @ts-nocheck
import { Route as rootRouteImport } from "@arrzdev/adaptv/root-route"
import { Route as homeRouteImport } from "./home.page"
import { Route as postRouteImport } from "./post.page"
const homeRoute = homeRouteImport.update({ id: "/", path: "/", getParentRoute: () => rootRouteImport } as any)
const postRoute = postRouteImport.update({ id: "/posts/$id", path: "/posts/$id", getParentRoute: () => rootRouteImport } as any)
export interface FileRoutesByFullPath { "/": typeof homeRoute; "/posts/$id": typeof postRoute }
export interface FileRoutesByTo { "/": typeof homeRoute; "/posts/$id": typeof postRoute }
export interface FileRoutesById { __root__: typeof rootRouteImport; "/": typeof homeRoute; "/posts/$id": typeof postRoute }
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: "/" | "/posts/$id"
  fileRoutesByTo: FileRoutesByTo
  to: "/" | "/posts/$id"
  id: "__root__" | "/" | "/posts/$id"
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren { homeRoute: typeof homeRoute; postRoute: typeof postRoute }
declare module "@arrzdev/adaptv/router" {
  interface FileRoutesByPath {
    "/": { id: "/"; path: "/"; fullPath: "/"; preLoaderRoute: typeof homeRouteImport; parentRoute: typeof rootRouteImport }
    "/posts/$id": { id: "/posts/$id"; path: "/posts/$id"; fullPath: "/posts/$id"; preLoaderRoute: typeof postRouteImport; parentRoute: typeof rootRouteImport }
  }
}
const rootRouteChildren: RootRouteChildren = { homeRoute, postRoute }
export const routeTree = rootRouteImport._addFileChildren(rootRouteChildren)._addFileTypes<FileRouteTypes>()
import type { getRouter } from "@arrzdev/adaptv/router"
declare module "@arrzdev/adaptv/router" {
  interface Register {
    router: Awaited<ReturnType<typeof getRouter>>
  }
}
`,
  [probeFile]: `
import type { AdaptvAppConfig } from "@arrzdev/adaptv/config"
import {
  createAdaptvRouter,
  createRootRoute,
  type getRouter,
  index,
  isRedirect,
  layout,
  notFound,
  physical,
  rootRoute,
  route,
  standaloneMemoryHistory,
  useNavigate,
} from "@arrzdev/adaptv/router"
import {
  index as routesIndex,
  layout as routesLayout,
  physical as routesPhysical,
  rootRoute as routesRootRoute,
  route as routesRoute,
} from "@arrzdev/adaptv/routes"
import type { CreateRootRouteConfig } from "@arrzdev/adaptv/shell"
//The engine's packages, for their export lists. \`@tanstack/history\` is not one of
//adaptv's dependencies; react-router re-exports its types (\`RouterHistory\`).
import "@tanstack/react-router"
import "@tanstack/router-core"
import "@tanstack/virtual-file-routes"

export const probes = {
  notFoundScreen: undefined as unknown as AdaptvAppConfig["notFoundScreen"],
  notFoundComponent: undefined as unknown as CreateRootRouteConfig["notFoundComponent"],
  notFound,
  isRedirect,
  index,
  layout,
  physical,
  route,
  rootRoute,
  routesIndex,
  routesLayout,
  routesPhysical,
  routesRoute,
  routesRootRoute,
  createRootRoute,
  getRouter: undefined as unknown as typeof getRouter,
  createAdaptvRouter,
  standaloneMemoryHistory,
}

//Typed routing still runs through the renamed router: a route in the tree is
//accepted, and one outside it is an error (the directive fails if it is not).
export function navigateProbe() {
  const navigate = useNavigate()
  navigate({ to: "/posts/$id", params: { id: "1" } })
  // @ts-expect-error not a route in the tree
  navigate({ to: "/nope" })
}
`,
}

function compile() {
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(path.join(repo, "tsconfig.json"), ts.sys.readFile)
      .config,
    ts.sys,
    repo,
  )
  const options: ts.CompilerOptions = {
    ...config.options,
    paths: {
      ...config.options.paths,
      "#adaptv-route-tree": [treeFile],
      "@arrzdev/adaptv/root-route": ["./src/routes/root-route.tsx"],
    },
  }
  const host = ts.createCompilerHost(options)
  const read = host.readFile
  host.readFile = (file) => files[path.resolve(file)] ?? read(file)
  const exists = host.fileExists
  host.fileExists = (file) => path.resolve(file) in files || exists(file)
  //The ambient declarations (`virtual:adaptv/*`, route globals) and the probe; every
  //module the probe imports comes in through resolution.
  const ambient = config.fileNames.filter((file) => file.endsWith(".d.ts"))
  const program = ts.createProgram([...ambient, probeFile], options, host)
  return { program, checker: program.getTypeChecker() }
}

const { program, checker } = compile()
const probe = program.getSourceFile(probeFile)
if (!probe) throw new Error("the probe did not compile")

const flags =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope

function exportedValue(name: string) {
  const module = checker.getSymbolAtLocation(probe as ts.SourceFile)
  const symbol =
    module && checker.tryGetMemberInModuleExports(name, module)
  if (!symbol) throw new Error(`the probe exports no ${name}`)
  return checker.getTypeOfSymbolAtLocation(symbol, probe as ts.SourceFile)
}

/** Every type the engine's packages export, by name: the words a hover must not show. */
const engineNames = new Set(
  probe.statements
    .filter(ts.isImportDeclaration)
    .filter((node) => !node.importClause)
    .map((node) => checker.getSymbolAtLocation(node.moduleSpecifier))
    .flatMap((module) =>
      module ? checker.getExportsOfModule(module) : [],
    )
    .map((symbol) => symbol.name)
    .filter((name) => /^[A-Z]/.test(name)),
)

function hover(name: string): string {
  const property = exportedValue("probes").getProperty(name)
  if (!property) throw new Error(`no probe named ${name}`)
  return checker.typeToString(
    checker.getTypeOfSymbolAtLocation(property, probe as ts.SourceFile),
    probe,
    flags,
  )
}

describe("adaptv's public types name adaptv, not the engine", () => {
  it("compiles the probe and its route tree without an error", () => {
    const errors = ts
      .getPreEmitDiagnostics(program, probe)
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))
    expect(errors).toEqual([])
  })

  it("knows the engine's type names, so the checks below can fail", () => {
    for (const name of [
      "NotFoundRouteProps",
      "RouterCore",
      "VirtualRootRoute",
    ])
      expect(engineNames).toContain(name)
  })

  //What each one prints, in full: the names in it are adaptv's.
  it.each([
    [
      "notFoundScreen",
      "(() => Promise<{ default: NotFoundScreenComponent; }>) | undefined",
    ],
    ["notFoundComponent", "NotFoundScreenComponent | undefined"],
    ["notFound", "(options?: NotFoundOptions) => NotFoundOptions"],
    ["isRedirect", "(value: unknown) => value is RouteRedirect"],
    ["index", "(file: string) => IndexRouteNode"],
    [
      "layout",
      "{ (file: string, children: RouteNode[]): LayoutRouteNode; (id: string, file: string, children: RouteNode[]): LayoutRouteNode; }",
    ],
    [
      "physical",
      "{ (pathPrefix: string, directory: string): PhysicalRouteNode; (directory: string): PhysicalRouteNode; }",
    ],
    [
      "route",
      "{ (path: string, children: RouteNode[]): PathRouteNode; (path: string, file: string): PathRouteNode; (path: string, file: string, children: RouteNode[]): PathRouteNode; }",
    ],
    [
      "rootRoute",
      "{ (children?: RouteNode[]): RootRouteNode; (file: string, children?: RouteNode[]): RootRouteNode; }",
    ],
    ["routesIndex", "(file: string) => IndexRouteNode"],
    [
      "createRootRoute",
      "(config: CreateRootRouteConfig) => AdaptvRootRoute",
    ],
    ["getRouter", "() => AppRouter"],
    [
      "createAdaptvRouter",
      "<TRouteTree extends AdaptvRouteTree>({ routeTree, memoryHistoryInStandalone, options, }: AdaptvRouterOptions<TRouteTree>) => AdaptvRouter<TRouteTree>",
    ],
    ["standaloneMemoryHistory", "() => AdaptvHistory | undefined"],
  ])("%s prints %s", (name, text) => {
    expect(hover(name)).toBe(text)
  })

  //The same, for every probe, as a rule rather than a list of strings: no word in the
  //printed type is a type the engine exports, and no path into an engine package.
  it("shows no engine type name in any probe", () => {
    const probes = checker
      .getPropertiesOfType(exportedValue("probes"))
      .map((property) => property.name)
    const leaks = probes.flatMap((name) => {
      const text = hover(name)
      const words = text.match(/[A-Za-z_$][\w$]*/g) ?? []
      return [
        ...words.filter((word) => engineNames.has(word)),
        ...(text.includes("@tanstack/") ? ["@tanstack/"] : []),
      ].map((word) => `${name}: ${word}`)
    })
    expect(leaks).toEqual([])
  })
})
