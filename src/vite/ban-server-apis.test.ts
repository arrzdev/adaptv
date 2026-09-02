import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  adaptvBanServerApisPlugin,
  describeServerApiBan,
  findServerRouteHandlers,
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

  it("leaves the Vite plugin subpath alone — it runs at config time", () => {
    //adaptv's own plugin imports this; it never enters the browser bundle graph
    expect(isBannedServerModule("@tanstack/react-start/plugin/vite")).toBe(
      false,
    )
  })

  it("is not fooled by a prefix collision", () => {
    expect(isBannedServerModule("@tanstack/react-start-devtools")).toBe(
      false,
    )
    expect(isBannedServerModule("my-@tanstack/react-start")).toBe(false)
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

describe("findServerRouteHandlers — the gap no import rule can reach", () => {
  //`createServerFileRoute` does NOT exist in the pinned @tanstack/react-start.
  //It was replaced by a `server` property on createFileRoute's options object —
  //and a config-object property is not an importable symbol, so no import-based
  //technique (TS, Biome noRestrictedImports, resolveId) can ever see it.
  it("finds a server property on a createFileRoute options object", () => {
    const code = `
      export const Route = createFileRoute("/x")({
        component: X,
        server: { handlers: { GET: () => new Response("hi") } },
      })
    `
    expect(findServerRouteHandlers(code)).not.toBeNull()
  })

  it("reports the offset of the offending property, for a caret frame", () => {
    const code = `createFileRoute("/x")({ server: { handlers: {} } })`
    expect(findServerRouteHandlers(code)).toBe(code.indexOf("server:"))
  })

  it("ignores a route with no server property", () => {
    const code = `createFileRoute("/x")({ component: X, loader: l })`
    expect(findServerRouteHandlers(code)).toBeNull()
  })

  it("ignores `server` outside a createFileRoute call entirely", () => {
    //an app is allowed its own variable called `server`
    const code = `const server = { handlers: {} }; export { server }`
    expect(findServerRouteHandlers(code)).toBeNull()
  })

  it("ignores a nested `server` key that is just app data", () => {
    //only the OPTIONS-OBJECT-level `server` is the TanStack API; a `server` field
    //inside loader data or component props is ordinary application state
    const code = `createFileRoute("/x")({
      loader: () => ({ config: { server: { handlers: 1 } } }),
    })`
    expect(findServerRouteHandlers(code)).toBeNull()
  })

  it("does not fire on the word appearing in a comment or string", () => {
    const code = `
      // server: { handlers } is banned here
      const doc = "server: { handlers: {} }"
      createFileRoute("/x")({ component: X })
    `
    expect(findServerRouteHandlers(code)).toBeNull()
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

function callTransform(code: string, id: string) {
  const plugin = adaptvBanServerApisPlugin()
  const sink: Reported[] = []
  const hook = plugin.transform as unknown as (
    this: unknown,
    c: string,
    i: string,
  ) => unknown
  try {
    hook.call(fakeContext(sink), code, id)
  } catch {
    //ditto
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

  it("lets dependencies through untouched", () => {
    expect(callResolveId("@tanstack/react-start", DEP)).toHaveLength(0)
  })

  it("lets the router through — it is not a server API", () => {
    expect(callResolveId("@tanstack/react-router", APP)).toHaveLength(0)
  })

  it("fails the build on `server: { handlers }` in a route", () => {
    const code = `createFileRoute("/x")({ server: { handlers: {} } })`
    const reported = callTransform(code, APP)
    expect(reported).toHaveLength(1)
    expect(reported[0]?.message).toContain("server")
  })

  it("passes the offset so the error renders a caret frame", () => {
    //this is why the scan returns an offset instead of a boolean: a bare message
    //with no position is materially harder to act on
    const code = `createFileRoute("/x")({ server: { handlers: {} } })`
    const reported = callTransform(code, APP)
    expect(reported[0]?.pos).toBe(code.indexOf("server:"))
  })

  it("does not scan dependency code", () => {
    const code = `createFileRoute("/x")({ server: { handlers: {} } })`
    expect(callTransform(code, DEP)).toHaveLength(0)
  })

  it("leaves a clean route alone", () => {
    expect(
      callTransform(`createFileRoute("/x")({ component: X })`, APP),
    ).toHaveLength(0)
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
