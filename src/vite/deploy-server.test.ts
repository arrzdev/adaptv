import { nitro } from "nitro/vite"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  adaptvDeployServerPlugins,
  DEPLOY_SERVER_ENVIRONMENT,
  emitIntoClientOutput,
} from "#adaptv/vite/deploy-server.ts"

//spied, not replaced: the tests below still read the real plugins' names
vi.mock("nitro/vite", async (importOriginal) => {
  const real = await importOriginal<typeof import("nitro/vite")>()
  return { ...real, nitro: vi.fn(real.nitro) }
})

beforeEach(() => {
  vi.mocked(nitro).mockClear()
})

describe("adaptvDeployServerPlugins", () => {
  it("asks Nitro for nothing unless the app prerenders", async () => {
    await adaptvDeployServerPlugins("ssr")
    expect(vi.mocked(nitro).mock.calls).toEqual([[undefined]])
  })

  it("crawls from / into x.html files when the app prerenders", async () => {
    //TUD-131: SSR of every page view ran a Cloudflare Worker out of CPU. The files
    //are served before the Worker, and `x.html` (not `x/index.html`) is what keeps
    //`/x` from being redirected to `/x/` there.
    await adaptvDeployServerPlugins("ssr", { prerender: true })
    expect(vi.mocked(nitro).mock.calls).toEqual([
      [
        {
          prerender: {
            routes: ["/"],
            crawlLinks: true,
            autoSubfolderIndex: false,
          },
        },
      ],
    ])
  })

  it("produces a server build for ssr", async () => {
    //The property this pins is that adaptv, not the consumer, owns the deploy
    //plugin. Before this the target came from whatever the app happened to put in
    //its own `vite.config.ts` — so "deploy anywhere" was something each app had to
    //re-learn per host. → `docs/decisions/rendering-and-delivery.md §2`
    const plugins = await adaptvDeployServerPlugins("ssr")
    expect(plugins.length).toBeGreaterThan(0)
  })

  it("produces nothing for spa", async () => {
    //A spa build is a bucket of files; there is no request-time server to build,
    //and on a static host nothing would ever invoke one. The static-host files are
    //that build's deploy story instead (`static-host.ts`).
    expect(await adaptvDeployServerPlugins("spa")).toEqual([])
  })

  it("passes no preset, so the platform's own answer wins", async () => {
    //Deliberate: the preset is auto-detected from the build environment on the
    //eight zero-config providers, and set by `NITRO_PRESET` everywhere else.
    //Anything adaptv passed here would override a correct answer with a guess —
    //which is the whole reason `web.host` was deleted rather than reimplemented.
    const flatten = (value: unknown): { name?: string }[] =>
      Array.isArray(value)
        ? value.flatMap(flatten)
        : value
          ? [value as { name?: string }]
          : []
    const names = flatten(await adaptvDeployServerPlugins("ssr"))
      .map((plugin) => plugin.name)
      .filter(Boolean)
    expect(names.length).toBeGreaterThan(0)
    //no adaptv-authored wrapper in the chain — the plugins are upstream's own
    expect(names.some((name) => name?.startsWith("adaptv:"))).toBe(false)
  })
})

describe("emitIntoClientOutput", () => {
  //the hooks, called the way Vite calls them, outside Vite
  function hooks(emit: () => Promise<void>) {
    const { buildStart, buildApp } = emitIntoClientOutput(emit)
    if (typeof buildStart !== "object" || typeof buildApp !== "object")
      throw new Error("both must be object hooks")
    return {
      start: (environment: string) =>
        // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
        (buildStart.handler as any).call({
          environment: { name: environment },
        }),
      app: (environments: Record<string, unknown>) =>
        // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
        (buildApp.handler as any).call({}, { environments }),
      order: buildApp.order,
    }
  }

  it("writes at the start of the server environment, once, and not again after the build", async () => {
    const calls: string[] = []
    const h = hooks(async () => {
      calls.push("emit")
    })
    //the client and SSR environments start first, before Nitro copies `public/`
    await h.start("client")
    await h.start("ssr")
    expect(calls).toEqual([])
    await h.start(DEPLOY_SERVER_ENVIRONMENT)
    await h.app({ [DEPLOY_SERVER_ENVIRONMENT]: {} })
    expect(calls).toEqual(["emit"])
    expect(h.order).toBe("post")
  })

  it("writes in buildApp post when the build has no server", async () => {
    const calls: string[] = []
    const h = hooks(async () => {
      calls.push("emit")
    })
    await h.start("client")
    await h.app({ client: {} })
    expect(calls).toEqual(["emit"])
  })

  it("fails a server build that never started the environment it names", async () => {
    //a renamed environment would otherwise write after the asset table exists:
    //the 404 at /sw.js again, with a green build
    const h = hooks(async () => {})
    await expect(
      h.app({ [DEPLOY_SERVER_ENVIRONMENT]: {} }),
    ).rejects.toThrow(/built without the app shell and the service worker/)
  })
})
