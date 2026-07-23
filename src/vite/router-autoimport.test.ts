import { describe, expect, it } from "vitest"
import {
  adaptvRouteAutoImportPlugin,
  detectRouteFactory,
  importsRouteFactory,
  resolveAutoImport,
  stripTanStackAutoImport,
  TANSTACK_AUTOIMPORT_PLUGIN,
} from "#adaptv/vite/router-autoimport"

describe("stripTanStackAutoImport", () => {
  it("removes the upstream plugin by name", () => {
    //by NAME, not position: Start reorders its internals between releases, and an
    //index-based removal would silently start deleting the wrong plugin
    const plugins = [
      { name: "a" },
      { name: TANSTACK_AUTOIMPORT_PLUGIN },
      { name: "b" },
    ]
    expect(
      stripTanStackAutoImport(plugins).map(
        (p) => (p as { name: string }).name,
      ),
    ).toEqual(["a", "b"])
  })

  it("reaches into nested arrays, which is how Start actually returns plugins", () => {
    const plugins = [
      { name: "a" },
      [{ name: TANSTACK_AUTOIMPORT_PLUGIN }, { name: "c" }],
    ]
    const result = stripTanStackAutoImport(plugins) as Array<
      { name: string } | Array<{ name: string }>
    >
    expect(
      (result[1] as Array<{ name: string }>).map((p) => p.name),
    ).toEqual(["c"])
  })

  it("leaves falsy entries alone — they are legal in a Vite plugin array", () => {
    const plugins = [
      null,
      false as const,
      undefined,
      { name: "a" },
    ] as never
    expect(stripTanStackAutoImport(plugins)).toHaveLength(4)
  })
})

describe("importsRouteFactory", () => {
  it("sees an import from the adaptv barrel", () => {
    //the whole bug: upstream only accepts ITS specifier, so a re-export is
    //invisible to it and it adds a duplicate binding
    expect(
      importsRouteFactory(
        'import { createFileRoute } from "@arrzdev/adaptv/router"',
        "createFileRoute",
      ),
    ).toBe(true)
  })

  it("still sees an import from TanStack directly", () => {
    //source-agnostic, so a not-yet-migrated route file keeps working untouched
    expect(
      importsRouteFactory(
        'import { createFileRoute } from "@tanstack/react-router"',
        "createFileRoute",
      ),
    ).toBe(true)
  })

  it("sees it in a multi-symbol, multiline import", () => {
    const code = `import {\n  Outlet,\n  createFileRoute,\n} from "@arrzdev/adaptv/router"`
    expect(importsRouteFactory(code, "createFileRoute")).toBe(true)
  })

  it("does not confuse a call with an import", () => {
    expect(
      importsRouteFactory(
        'export const R = createFileRoute("/x")({})',
        "createFileRoute",
      ),
    ).toBe(false)
  })
})

describe("detectRouteFactory", () => {
  it("detects both factories", () => {
    expect(detectRouteFactory('createFileRoute("/x")')).toBe(
      "createFileRoute",
    )
    expect(detectRouteFactory('createLazyFileRoute("/x")')).toBe(
      "createLazyFileRoute",
    )
  })

  it("returns null for an ordinary module", () => {
    expect(detectRouteFactory("export const x = 1")).toBeNull()
  })
})

describe("resolveAutoImport", () => {
  it("adds the adaptv import when the factory is unbound", () => {
    const statement = resolveAutoImport(
      'export const R = createFileRoute("/x")({})',
    )
    expect(statement).toContain("@arrzdev/adaptv/router")
    expect(statement).toContain("createFileRoute")
  })

  it("adds NOTHING when already imported — this is the duplicate-binding bug", () => {
    const code =
      'import { createFileRoute } from "@arrzdev/adaptv/router"\nconst R = createFileRoute("/x")({})'
    expect(resolveAutoImport(code)).toBeNull()
  })

  it("adds nothing when already imported from TanStack", () => {
    const code =
      'import { createFileRoute } from "@tanstack/react-router"\nconst R = createFileRoute("/x")({})'
    expect(resolveAutoImport(code)).toBeNull()
  })

  it("adds nothing to a module that is not a route", () => {
    expect(resolveAutoImport("export const x = 1")).toBeNull()
  })
})

describe("adaptvRouteAutoImportPlugin", () => {
  const ROUTE_ID = "/app/src/routing/x.tsx"

  /**
   * Register `id` the way the route generator does. Without this the plugin
   * correctly refuses to touch the file — see the gate test below.
   */
  function withRegisteredRoute(id: string, run: () => void) {
    const scope = globalThis as {
      TSR_ROUTES_BY_ID_MAP?: Map<string, unknown>
    }
    const previous = scope.TSR_ROUTES_BY_ID_MAP
    scope.TSR_ROUTES_BY_ID_MAP = new Map([[id, {}]])
    try {
      run()
    } finally {
      scope.TSR_ROUTES_BY_ID_MAP = previous
    }
  }

  function transform(code: string, id = ROUTE_ID) {
    const plugin = adaptvRouteAutoImportPlugin()
    const hook = plugin.transform as unknown as (
      this: unknown,
      c: string,
      i: string,
    ) => { code: string } | null
    return hook.call({}, code, id)
  }

  it("runs before everything else, like the plugin it replaces", () => {
    expect(adaptvRouteAutoImportPlugin().enforce).toBe("pre")
  })

  it("refuses any file the generator has not registered as a route", () => {
    //THE gate. Without it the transform also fires on the virtual modules the
    //code-splitter derives from a route — where the import has already been
    //stripped — and re-adds one that collides:
    //`Identifier 'createFileRoute' has already been declared`, in a file that is
    //correct on disk. Upstream gates the same way, for the same reason.
    expect(
      transform('export const R = createFileRoute("/x")({})'),
    ).toBeNull()
  })

  it("matches the registry's POSIX separators on a Windows path", () => {
    withRegisteredRoute("C:/app/src/routing/x.tsx", () => {
      const result = transform(
        'export const R = createFileRoute("/x")({})',
        "C:\\app\\src\\routing\\x.tsx",
      )
      expect(result?.code).toContain("@arrzdev/adaptv/router")
    })
  })

  it("injects the import into a bare route file", () => {
    withRegisteredRoute(ROUTE_ID, () => {
      const result = transform(
        'export const R = createFileRoute("/x")({})',
      )
      expect(result?.code).toContain('from "@arrzdev/adaptv/router"')
    })
  })

  it("leaves an already-correct route file untouched", () => {
    const code =
      'import { createFileRoute } from "@arrzdev/adaptv/router"\nconst R = createFileRoute("/x")({})'
    expect(transform(code)).toBeNull()
  })

  it("ignores non-JS/TS files", () => {
    expect(
      transform('createFileRoute("/x")', "/app/styles.css"),
    ).toBeNull()
  })
})
