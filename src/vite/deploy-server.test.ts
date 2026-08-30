import { describe, expect, it } from "vitest"
import { adaptvDeployServerPlugins } from "#adaptv/vite/deploy-server.ts"

describe("adaptvDeployServerPlugins", () => {
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
