// @vitest-environment node
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  ALLOWED_START_SPECIFIERS,
  adaptvBanServerApisPlugin,
  describeServerApiBan,
  isApplicationSource,
  isBannedServerModule,
} from "#adaptv/vite/ban-server-apis"

const APP = path.join("/app", "src", "routes", "index.tsx")
const DEP = path.join("/app", "node_modules", "some-lib", "dist", "i.js")

describe("isBannedServerModule", () => {
  it("bans the Start entrypoint and its server subpath", () => {
    expect(isBannedServerModule("@tanstack/react-start")).toBe(true)
    expect(isBannedServerModule("@tanstack/react-start/server")).toBe(true)
  })

  it("leaves the router alone — routing is not a server API", () => {
    //L3 is explicit: ban server-only calls, NOT loaders. `beforeLoad` and
    //`loader` are Router features and are fully isomorphic.
    expect(isBannedServerModule("@tanstack/react-router")).toBe(false)
  })

  it("leaves every non-Start package adaptv imports alone", () => {
    //the family pattern must stop at Start: a `start` inside any other name
    //would refuse routing, data or virtualisation from app code
    for (const source of [
      "@tanstack/react-router",
      "@tanstack/react-router-devtools",
      "@tanstack/router-core",
      "@tanstack/router-plugin",
      "@tanstack/router-generator",
      "@tanstack/virtual-file-routes",
      "@tanstack/react-query",
      "@tanstack/react-virtual",
      "@tanstack/nitro-v2-vite-plugin",
    ]) {
      expect(isBannedServerModule(source), source).toBe(false)
    }
  })

  it("refuses the Vite plugin subpath from app source", () => {
    //adaptv imports it only from `adaptv-plugin.ts`, which Vite loads with the
    //config before any plugin exists, so no importer in the module graph needs it
    expect(isBannedServerModule("@tanstack/react-start/plugin/vite")).toBe(
      true,
    )
  })

  it("refuses the sibling Start packages, which carry the same compiler", () => {
    //start-plugin-core builds its roots as `@tanstack/${framework}-start`
    //(start-compiler/config.js), and `@tanstack/start` is the old name
    for (const source of [
      "@tanstack/solid-start",
      "@tanstack/solid-start/server",
      "@tanstack/solid-start-client",
      "@tanstack/vue-start",
      "@tanstack/vue-start/client-rpc",
      "@tanstack/vue-start-server",
      "@tanstack/start",
      "@tanstack/start/server",
      //more than one word before `-start`: its getFormData is a
      //`createServerFn().handler()`, and start-plugin-core compiles it as a
      //framework package (vite/plugin.js crawlFrameworkPkgs)
      "@tanstack/react-form-start",
      "@tanstack/react-form-start/sub",
    ]) {
      expect(isBannedServerModule(source), source).toBe(true)
    }
  })

  it("is not fooled by a prefix collision", () => {
    expect(isBannedServerModule("@tanstack/react-starter")).toBe(false)
    expect(isBannedServerModule("@tanstack/startup")).toBe(false)
    expect(isBannedServerModule("my-@tanstack/react-start")).toBe(false)
  })

  //The Start compiler does not decide by specifier. It seeds its known roots by
  //PACKAGE — `@tanstack/start-client-core` and `@tanstack/start-fn-stubs` beside
  //`@tanstack/react-start` — and then follows re-exports to the binding, so
  //anything that reaches one of those exports is a server function to it
  //(start-plugin-core `start-compiler/compiler.js` init() and
  //resolveKnownImportKind()). Two exact specifiers left every other door open.
  it("bans the compiler's other roots, which a flat install resolves", () => {
    expect(isBannedServerModule("@tanstack/start-client-core")).toBe(true)
    expect(isBannedServerModule("@tanstack/start-fn-stubs")).toBe(true)
  })

  it("bans every Start subpath that carries server code", () => {
    for (const source of [
      "@tanstack/react-start/client-rpc",
      "@tanstack/react-start/server-rpc",
      "@tanstack/react-start/ssr-rpc",
      "@tanstack/react-start/rsc",
      "@tanstack/react-start/rsc/serialization/server",
      "@tanstack/react-start/rsbuild/ssr-decode",
      "@tanstack/react-start/server-only",
    ]) {
      expect(isBannedServerModule(source), source).toBe(true)
    }
  })

  it("bans Start's internal packages whole, subpaths included", () => {
    for (const source of [
      "@tanstack/start-client-core/client-rpc",
      "@tanstack/start-server-core",
      "@tanstack/start-server-core/createServerRpc",
      "@tanstack/start-storage-context",
      "@tanstack/react-start-server",
      "@tanstack/react-start-rsc",
    ]) {
      expect(isBannedServerModule(source), source).toBe(true)
    }
  })

  it("bans a Start subpath it has never heard of", () => {
    //deny by default: an upstream release that adds a subpath must not open a
    //door until someone has read what is behind it
    expect(isBannedServerModule("@tanstack/react-start/next-thing")).toBe(
      true,
    )
  })

  it("is not bypassed by a query suffix", () => {
    //Vite resolves `pkg?x` like `pkg`, so the suffix must not dodge the rule
    expect(isBannedServerModule("@tanstack/react-start?x")).toBe(true)
    expect(
      isBannedServerModule("@tanstack/start-client-core?import"),
    ).toBe(true)
  })

  it("is not bypassed by a path into the install", () => {
    //the compiler resolves its roots from the importer and compares bindings,
    //so a file path to the same module is the same server function to it
    for (const source of [
      "../node_modules/@tanstack/start-client-core/dist/esm/index.js",
      "/app/node_modules/.pnpm/@tanstack+react-start@1/node_modules/@tanstack/react-start/dist/esm/index.js",
      "..\\node_modules\\@tanstack\\start-client-core\\dist\\esm\\index.js",
    ]) {
      expect(isBannedServerModule(source), source).toBe(true)
    }
  })

  it("allows the client entry's Start subpath", () => {
    expect(isBannedServerModule("@tanstack/react-start/client")).toBe(
      false,
    )
  })

  it("refuses client-side subpaths nothing in the graph imports", () => {
    //deny by default means allow only what a real importer needs
    for (const source of [
      "@tanstack/react-start/hydration",
      "@tanstack/react-start/client-only",
      "@tanstack/solid-start/client",
    ]) {
      expect(isBannedServerModule(source), source).toBe(true)
    }
  })

  it("allows the server entry, which is where server code belongs", () => {
    expect(
      isBannedServerModule("@tanstack/react-start/server-entry"),
    ).toBe(false)
  })
})

/**
 * adaptv's own entries import Start, and under a linked install they are NOT
 * under `node_modules` — the playground consumes adaptv by `link:`, so Vite sees
 * `<repo>/src/routes/client-entry.tsx` and the ban governs it like app code. An
 * over-broad rule kills every dev server and build there, before any page loads.
 * The specifiers are read from the files, so a new Start import in either entry
 * is held to this without anyone remembering to add it here.
 */
describe("adaptv's own entries — the ban must not refuse them", () => {
  const entries = [
    "src/routes/client-entry.tsx",
    "src/interface/server-entry.ts",
  ].map((file) => path.join(process.cwd(), file))

  it.each(entries)("lets %s resolve its Start imports", (file) => {
    //the precondition: outside node_modules, this file IS application source
    expect(isApplicationSource(file)).toBe(true)
    //every import form: `from "x"`, `from 'x'`, a bare `import "x"` marker and a
    //dynamic `import("x")`
    const specifiers = [
      ...readFileSync(file, "utf8").matchAll(
        /(?:from|import)\s*\(?\s*["']([^"']+)["']/g,
      ),
    ]
      .map((m) => m[1] as string)
      //the Start family: whatever the ban refuses, plus what it allows by name
      .filter(
        (s) => isBannedServerModule(s) || ALLOWED_START_SPECIFIERS.has(s),
      )
    expect(specifiers.length).toBeGreaterThan(0)
    for (const source of specifiers) {
      expect(describeServerApiBan(source, file), source).toBeNull()
    }
  })
})

/**
 * The linter layer ships the same rule. Biome cannot import a TS set, so the JSON
 * is held to the build here: a subpath allowed by one layer and refused by the
 * other would squiggle code that builds, or build code that squiggles.
 *
 * Comparing the two allowlists alone is not enough — that is how
 * `@tanstack/react-form-start` built clean while the glob `@tanstack/*-start`
 * already flagged it. So the verdicts are compared, over one name list, with the
 * glob groups evaluated the way Biome evaluates them (gitignore-style: `*` stays
 * inside a path segment, `**` crosses them, a `!` pattern re-allows, the last
 * matching pattern wins). That reading was checked once against a real
 * `biome lint` over the same names.
 */
describe("biome-shared.json — the lint layer bans the same modules", () => {
  const shared = JSON.parse(
    readFileSync(path.join(process.cwd(), "biome-shared.json"), "utf8"),
  )
  const options = shared.linter.rules.style.noRestrictedImports.options
  const patterns: { group: string[] }[] = options.patterns ?? []
  const groups = patterns.flatMap((p) => p.group)

  it("bans every Start package and subpath, not two specifiers", () => {
    expect(groups).toEqual(
      expect.arrayContaining([
        "@tanstack/start",
        "@tanstack/start/**",
        "@tanstack/start-*",
        "@tanstack/start-*/**",
        "@tanstack/*-start",
        "@tanstack/*-start/**",
        "@tanstack/*-start-*",
        "@tanstack/*-start-*/**",
      ]),
    )
  })

  //Biome reads each `patterns` entry on its own: a `!` re-allows only within its
  //own group, and an import is refused when any group refuses it.
  function globVerdict(source: string): boolean {
    return patterns.some((p) => groupVerdict(p.group, source))
  }

  function groupVerdict(group: string[], source: string): boolean {
    let banned = false
    for (const entry of group) {
      const negated = entry.startsWith("!")
      const glob = negated ? entry.slice(1) : entry
      const pattern = glob
        .split(/(\*\*|\*)/)
        .map((part) =>
          part === "**"
            ? ".*"
            : part === "*"
              ? "[^/]*"
              : part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("")
      if (new RegExp(`^${pattern}$`).test(source)) banned = !negated
    }
    return banned
  }

  const PARITY_NAMES = [
    "react-start",
    "react-form-start",
    "eslint-plugin-start",
    "react-native-start",
    "vue2-start",
    "solid-start",
    "vue-start",
    "start",
    "start-client-core",
    "start-server-functions-client",
    "react-start-plugin",
    "create-start",
    "router-ssr-query",
    "react-router-ssr-query",
    "react-router",
    "router-core",
    "react-query",
    "react-starter",
    "startup",
  ].flatMap((name) => [`@tanstack/${name}`, `@tanstack/${name}/sub`])

  it.each([
    ...PARITY_NAMES,
    "@tanstack/react-start/client",
    "@tanstack/react-start/server-entry",
  ])("gives %s the same verdict as the build", (source) => {
    expect(globVerdict(source)).toBe(isBannedServerModule(source))
  })

  it("re-allows exactly the specifiers the build allows", () => {
    const negated = groups
      .filter((g) => g.startsWith("!"))
      .map((g) => g.slice(1))
      .sort()
    expect(negated).toEqual([...ALLOWED_START_SPECIFIERS].sort())
  })
})

describe("isApplicationSource — the ban applies to app code only", () => {
  it("treats files under the app root as application source", () => {
    expect(isApplicationSource(APP)).toBe(true)
  })

  it("exempts dependencies — adaptv must not break the ecosystem", () => {
    //TanStack Start's own internals import these constantly. Banning them there
    //would make the framework unusable rather than safe.
    expect(isApplicationSource(DEP)).toBe(false)
  })

  it("exempts an absent importer (entry resolution, not app code)", () => {
    expect(isApplicationSource(undefined)).toBe(false)
  })

  it("exempts virtual modules, which have no file to blame", () => {
    expect(isApplicationSource("\0virtual:adaptv/pwa-register")).toBe(
      false,
    )
    expect(isApplicationSource("virtual:adaptv/pwa-register")).toBe(false)
  })

  it("exempts a nested node_modules (pnpm's real on-disk shape)", () => {
    const nested = path.join(
      "/app",
      "node_modules",
      ".pnpm",
      "x@1",
      "node_modules",
      "x",
      "i.js",
    )
    expect(isApplicationSource(nested)).toBe(false)
  })
})

describe("describeServerApiBan — the decision and the message", () => {
  it("reports a violation for banned module + app importer", () => {
    const message = describeServerApiBan("@tanstack/react-start", APP)
    expect(message).not.toBeNull()
  })

  it("says WHY, not just that it is forbidden", () => {
    //a bare "banned" message sends people to search the codebase. The reason is
    //the whole point: it dies on a target they may not have built yet.
    const message =
      describeServerApiBan("@tanstack/react-start", APP) ?? ""
    expect(message).toContain("@tanstack/react-start")
    expect(message).toContain("iOS and Android")
    //the target is named as the dev knows it, never as the engine underneath (L20);
    //`bin/lib/opacity.test.mjs` holds the whole message to that
    expect(message).not.toMatch(/capacitor/i)
    expect(message).toContain("docs/design/rendering.md")
  })

  it("allows the same import from a dependency", () => {
    expect(describeServerApiBan("@tanstack/react-start", DEP)).toBeNull()
  })

  it("allows non-banned modules from app code", () => {
    expect(describeServerApiBan("@tanstack/react-router", APP)).toBeNull()
  })
})

type Reported = { message: string; id?: string; pos?: unknown }

/**
 * Minimal stand-in for Rollup/Rolldown's plugin context. Only `this.error` is
 * exercised, and it must THROW — the real one does, and a hook that merely
 * recorded the error would let the build continue and silently ship the bug.
 */
function fakeContext(sink: Reported[]) {
  return {
    error(err: { message: string; id?: string }, pos?: unknown): never {
      sink.push({ ...err, pos })
      throw new Error(err.message)
    },
  }
}

function callResolveId(source: string, importer: string | undefined) {
  const plugin = adaptvBanServerApisPlugin()
  const sink: Reported[] = []
  const hook = plugin.resolveId as unknown as (
    this: unknown,
    s: string,
    i: string | undefined,
  ) => unknown
  try {
    hook.call(fakeContext(sink), source, importer)
  } catch {
    //the throw is the contract; the recorded diagnostic is what we assert on
  }
  return sink
}

describe("adaptvBanServerApisPlugin", () => {
  it("runs before Start so the ban wins the specifier", () => {
    //enforce:"pre" is load-bearing: without it tanstackStart() can resolve
    //@tanstack/react-start first and the hook never sees it
    const plugin = adaptvBanServerApisPlugin()
    expect(plugin.enforce).toBe("pre")
    expect(plugin.name).toBe("adaptv:ban-server-apis")
  })

  it("fails the build on a banned import from app source", () => {
    const reported = callResolveId("@tanstack/react-start", APP)
    expect(reported).toHaveLength(1)
    expect(reported[0]?.message).toContain("@tanstack/react-start")
    expect(reported[0]?.id).toBe(APP)
  })

  it("fails the build on createServerFn's other root from app source", () => {
    //`import { createServerFn } from "@tanstack/start-client-core"` compiles to
    //the same RPC as the `@tanstack/react-start` import, and built clean before
    const reported = callResolveId("@tanstack/start-client-core", APP)
    expect(reported).toHaveLength(1)
    expect(reported[0]?.message).toContain("@tanstack/start-client-core")
    expect(reported[0]?.id).toBe(APP)
  })

  it("lets the client entry's Start import through from app source", () => {
    //an app that ejects `src/client.tsx` writes the same import adaptv's does
    expect(
      callResolveId("@tanstack/react-start/client", APP),
    ).toHaveLength(0)
  })

  it("lets dependencies through untouched", () => {
    expect(callResolveId("@tanstack/react-start", DEP)).toHaveLength(0)
    expect(callResolveId("@tanstack/start-client-core", DEP)).toHaveLength(
      0,
    )
  })

  it("lets the router through — it is not a server API", () => {
    expect(callResolveId("@tanstack/react-router", APP)).toHaveLength(0)
  })

  it("leaves the compiler's RPC imports to the server boundary, which names the server function", () => {
    //the compiler writes them into the dev's module; refusing them here would name an
    //import the dev never wrote, and win over the report that names what they did
    for (const source of [
      "@tanstack/react-start/client-rpc",
      "@tanstack/react-start/server-rpc",
      "@tanstack/react-start/ssr-rpc",
    ])
      expect(callResolveId(source, APP), source).toHaveLength(0)
    expect(callResolveId("@tanstack/react-start/rsc", APP)).toHaveLength(1)
  })
})

describe("isApplicationSource — regression: `vite dev` (index.html importer)", () => {
  //The original rule was "anything outside node_modules". That broke the dev
  //server: TanStack Start's own entry resolution attributes
  //`@tanstack/react-start` to the app's index.html, which satisfied the rule —
  //so the ban fired on the framework's own bootstrap and `vite dev` died before
  //serving anything. Build passed, dev did not, which is why this was missed.
  it("does NOT treat index.html as application source", () => {
    expect(isApplicationSource("/app/index.html")).toBe(false)
  })

  it("ignores an importer with no source extension at all", () => {
    expect(isApplicationSource("/app/some-entry")).toBe(false)
  })

  it("still governs real source files", () => {
    for (const file of [
      "/app/src/main.tsx",
      "/app/src/a.ts",
      "/app/src/b.jsx",
      "/app/src/c.mjs",
    ]) {
      expect(isApplicationSource(file)).toBe(true)
    }
  })

  it("tolerates a query suffix, which Vite appends routinely", () => {
    expect(isApplicationSource("/app/src/main.tsx?v=abc123")).toBe(true)
  })
})
