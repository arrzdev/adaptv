// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Plugin, ResolvedConfig } from "vite"
import { afterEach, describe, expect, it } from "vitest"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import type { AdaptvBuildStamp } from "#adaptv/vite/build-stamp.ts"
import {
  adaptvBuildStampPlugin,
  BUILD_ID_ENV,
  buildStampPath,
  bundleIsStale,
  fileHash,
  readBuildStamp,
} from "#adaptv/vite/build-stamp.ts"

/**
 * The invalidation this file exists for, stated as a test:
 *
 * a `themeColor` edit re-derives the native project's splash colours (they are gated on
 * `appConfigFingerprint`) but used to leave the web bundle `cap sync` copies into the same
 * project untouched — one app, two colours. The stamp is what makes the bundle answer to
 * the same signal, so every case below is a way that answer can go wrong.
 */

const OUT = ".adaptv/web"

function app(): string {
  const root = mkdtempSync(path.join(tmpdir(), "adaptv-stamp-"))
  mkdirSync(path.join(root, OUT), { recursive: true })
  return root
}

/** Write a shell and a stamp that describes it — a healthy build, for `configId`. */
function build(root: string, configId: string, html = "<html>"): void {
  const shell = path.join(root, OUT, "index.html")
  writeFileSync(shell, html)
  stamp(root, {
    target: "capacitor",
    render: "spa",
    outDir: OUT,
    shell: "index.html",
    shellHash: fileHash(shell),
    configId,
  })
}

function stamp(root: string, value: Partial<AdaptvBuildStamp>): void {
  const file = buildStampPath(root, "capacitor")
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value))
}

describe("bundleIsStale — may this bundle be synced into the native project?", () => {
  it("accepts the bundle the current config produced", () => {
    const root = app()
    build(root, "cfg-1")
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  it("rejects a bundle built before the config was edited", () => {
    //THE bug. `dev ios` skipped the build whenever a bundle existed at all, so the
    //shell inside the `.ipa` kept the colour the dev had already replaced while the
    //native splash beside it was regenerated with the new one.
    const root = app()
    build(root, "cfg-before")
    expect(bundleIsStale(root, "capacitor", "cfg-after")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("rejects a shell whose bytes moved after the build that stamped it", () => {
    //The OUTPUTS half. A cache key alone cannot see a hand-edited, half-written or
    //externally-replaced bundle; asking whether the document on disk is still the one
    //this build wrote can. Same shape as `generateAssets`.
    const root = app()
    build(root, "cfg-1")
    writeFileSync(path.join(root, OUT, "index.html"), "<html>edited")
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("rejects a bundle whose shell is gone", () => {
    const root = app()
    build(root, "cfg-1")
    rmSync(path.join(root, OUT, "index.html"))
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("rejects a build the CLI did not run", () => {
    //A bare `vite build` stamps no id, because the id has exactly one producer. An
    //unknown provenance is not a pass — it is the reason to rebuild.
    const root = app()
    build(root, "cfg-1")
    const shell = path.join(root, OUT, "index.html")
    stamp(root, {
      target: "capacitor",
      render: "spa",
      outDir: OUT,
      shell: "index.html",
      shellHash: fileHash(shell),
      configId: null,
    })
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("rejects a bundle with no stamp at all", () => {
    const root = app()
    writeFileSync(path.join(root, OUT, "index.html"), "<html>")
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("survives a corrupt stamp without throwing", () => {
    //A build killed mid-write leaves half a JSON document. It must read as stale, not
    //as a crashed command.
    const root = app()
    const file = buildStampPath(root, "capacitor")
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, "{ not json")
    expect(readBuildStamp(root, "capacitor")).toBeNull()
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("keeps the two lineages apart", () => {
    //`preview all` builds both from one command. One file for both would leave
    //whichever ran last describing the other's directory.
    const root = app()
    build(root, "cfg-1")
    expect(buildStampPath(root, "web")).not.toBe(
      buildStampPath(root, "capacitor"),
    )
    expect(readBuildStamp(root, "web")).toBeNull()
    rmSync(root, { recursive: true, force: true })
  })
})

/** Run the plugin's two hooks the way Vite would, outside Vite. */
async function runStampPlugin(
  context: AdaptvContext,
  outDir: string | undefined,
): Promise<void> {
  const plugin = adaptvBuildStampPlugin(context)
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  ;(plugin.configResolved as any).call({}, {
    root: context.appRoot,
    environments: { client: { build: { outDir } } },
  } as unknown as ResolvedConfig)
  const hook = (plugin as Plugin).buildApp
  if (typeof hook !== "object" || !hook.handler)
    throw new Error(
      "buildApp must be an object hook so `order` can be set",
    )
  expect(hook.order).toBe("post")
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  await (hook.handler as any).call({}, {})
}

describe("adaptvBuildStampPlugin — what a build writes down about itself", () => {
  const savedId = process.env[BUILD_ID_ENV]
  afterEach(() => {
    if (savedId === undefined) delete process.env[BUILD_ID_ENV]
    else process.env[BUILD_ID_ENV] = savedId
  })

  const context = (
    root: string,
    target: "web" | "capacitor",
    render?: "ssr" | "spa",
  ): AdaptvContext => ({
    appRoot: root,
    loaded: null,
    target,
    ...(render ? { web: { render, sw: { enabled: true } } } : {}),
  })

  it("stamps where the client build wrote, the shell, its hash and the CLI's config id", async () => {
    const root = app()
    writeFileSync(path.join(root, OUT, "index.html"), "<html>")
    process.env[BUILD_ID_ENV] = "cfg-1"
    await runStampPlugin(context(root, "capacitor", "spa"), OUT)
    expect(readBuildStamp(root, "capacitor")).toEqual({
      target: "capacitor",
      render: "spa",
      outDir: OUT,
      shell: "index.html",
      shellHash: fileHash(path.join(root, OUT, "index.html")),
      configId: "cfg-1",
    })
    //the stamp it just wrote is the one `dev ios` accepts
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  it("stamps a build that emitted no shell, and one the CLI did not run, as nothing to trust", async () => {
    //no `web` on the context: the render defaults to ssr, whose shell is absent here
    const root = app()
    delete process.env[BUILD_ID_ENV]
    await runStampPlugin(context(root, "web"), "dist/client")
    const raw = JSON.parse(
      readFileSync(buildStampPath(root, "web"), "utf8"),
    ) as AdaptvBuildStamp
    expect(raw).toEqual({
      target: "web",
      render: "ssr",
      outDir: path.join("dist", "client"),
      shell: null,
      shellHash: null,
      configId: null,
    })
    expect(bundleIsStale(root, "web", "cfg-1")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("refuses to stamp when the client output directory was never captured", async () => {
    //Vite resolved no client `outDir`, so there is nothing true to write. A guessed
    //`dist/client` here is exactly how the CLI used to name a directory the build
    //had not touched.
    const root = app()
    await expect(
      runStampPlugin(context(root, "web", "ssr"), undefined),
    ).rejects.toThrow(/client output directory is unknown/)
    expect(existsSync(buildStampPath(root, "web"))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })
})
