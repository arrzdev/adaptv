// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Plugin, PluginOption, ResolvedConfig } from "vite"
import { afterEach, describe, expect, it } from "vitest"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { adaptv } from "#adaptv/vite/adaptv-plugin.ts"
import { adaptvStaticHostPlugin } from "#adaptv/vite/static-host.ts"

/*
 * The static-host files, per render × target. → `docs/decisions/rendering-and-delivery.md` §2,
 * `docs/design/lifecycle.md` §3.2, `docs/design/vite-plugin-map.md` §2.4,
 * `docs/decisions/register.md` B26 (the emit gap, and the capacitor half of its fix)
 *
 * `render: "spa"` on the WEB lineage writes four files, each read by one host
 * and ignored by the rest. `render: "ssr"` writes none, because `_redirects`
 * would take every navigation away from the server. And a Capacitor bundle is
 * `render: "spa"` as well, so the gate that keeps them out of every `.ipa` and
 * `.apk` is the target, enforced by not registering the plugin at all.
 */

const SHELL = '<!DOCTYPE html>\n<div id="root"></div>\n'
const HOST_FILES = ["404.html", ".nojekyll", "_redirects"]

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function tempRoot(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "adaptv-static-host-"))
  roots.push(dir)
  return dir
}

function contextFor(render: "ssr" | "spa", shell: string | null) {
  const appRoot = tempRoot()
  const clientDir = path.join(appRoot, "dist/client")
  mkdirSync(path.join(clientDir, "assets"), { recursive: true })
  writeFileSync(path.join(clientDir, "assets/client-abc123.js"), "")
  if (shell !== null) {
    const name = render === "spa" ? "index.html" : "adaptv-shell.html"
    writeFileSync(path.join(clientDir, name), shell)
  }
  const context: AdaptvContext = {
    appRoot,
    target: "web",
    web: { render, sw: { enabled: true } },
    clientOutDir: clientDir,
    loaded: null,
  }
  return { clientDir, context }
}

/** Call a plugin's `buildApp` handler the way Vite would, outside Vite. */
async function runBuildApp(plugin: Plugin): Promise<void> {
  const hook = plugin.buildApp
  if (typeof hook !== "object" || !hook.handler)
    throw new Error(
      `${plugin.name}: buildApp must be an object hook so \`order\` can be set`,
    )
  expect(hook.order).toBe("post")
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  await (hook.handler as any).call({}, {})
}

describe("adaptvStaticHostPlugin — what a web build hands a static host", () => {
  it("writes the shell, an identical 404.html, .nojekyll and the SPA rule under render: spa", async () => {
    const { clientDir, context } = contextFor("spa", SHELL)
    await runBuildApp(adaptvStaticHostPlugin(context))

    //exactly these, and nothing else: each has a named host behind it, and a
    //fifth file should arrive as a decision, not as a side effect
    expect(readdirSync(clientDir).sort()).toEqual(
      [
        ".nojekyll",
        "404.html",
        "_redirects",
        "assets",
        "index.html",
      ].sort(),
    )
    expect(readFileSync(path.join(clientDir, "index.html"), "utf8")).toBe(
      SHELL,
    )
    //a different document here would render a different app for anyone who
    //deep-linked on GitHub Pages or Netlify
    expect(readFileSync(path.join(clientDir, "404.html"), "utf8")).toBe(
      SHELL,
    )
    //empty is the whole file: its existence turns Jekyll off
    expect(readFileSync(path.join(clientDir, ".nojekyll"), "utf8")).toBe(
      "",
    )
    //200, not 301: the URL has to survive so the client router can resolve it
    expect(readFileSync(path.join(clientDir, "_redirects"), "utf8")).toBe(
      "/*    /index.html   200\n",
    )
  })

  it("writes nothing under render: ssr, where _redirects would hijack the server", async () => {
    const { clientDir, context } = contextFor("ssr", SHELL)
    await runBuildApp(adaptvStaticHostPlugin(context))

    for (const name of [...HOST_FILES, "index.html"])
      expect(existsSync(path.join(clientDir, name))).toBe(false)
  })

  it("fails loudly when the shell is not on disk yet, instead of shipping a blank deploy", async () => {
    //the ordering shell → worker → static-host is load-bearing (vite-plugin-map
    //§2.3); run first, this would copy nothing and the host would serve a 404
    const { context } = contextFor("spa", null)
    await expect(
      runBuildApp(adaptvStaticHostPlugin(context)),
    ).rejects.toThrow(/index\.html is missing/)
  })
})

describe("adaptv() — the static-host files follow the target, not the render mode", () => {
  /**
   * A real `adaptv()` call on a throwaway app, and the plugins it returns run
   * against a client output that already holds a shell.
   *
   * The factory writes process-wide env vars for the route generator; they are
   * restored so no other suite in the worker inherits a temp dir's paths.
   */
  async function emitFor(target: "web" | "capacitor") {
    const appRoot = tempRoot()
    writeFileSync(
      path.join(appRoot, "adaptv.config.ts"),
      `export default {
        name: "Probe",
        description: "fixture",
        themeColor: { light: "#ffffff", dark: "#000000" },
        styles: "./src/styles/main.css",
        router: {},
        render: "spa",
      }\n`,
    )
    const clientDir = path.join(appRoot, "out/client")
    mkdirSync(clientDir, { recursive: true })
    writeFileSync(path.join(clientDir, "index.html"), SHELL)

    const envKeys = [
      "ADAPTV_ROUTER_PKG",
      "ADAPTV_START_PKG",
      "TSR_TMP_DIR",
      "ADAPTV_ROOT_ROUTE_FILE",
    ]
    const savedEnv = envKeys.map((key) => [key, process.env[key]] as const)
    let plugins: Plugin[]
    try {
      plugins = flatten(await adaptv({ appRoot, target }))
    } finally {
      for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }

    //the two lineage-specific emitters, in the order the factory returned them;
    //the shell and the worker have suites of their own
    const emitters = plugins.filter(
      (plugin) =>
        plugin.name === "adaptv:static-host" ||
        plugin.name === "adaptv:native-bundle",
    )
    const resolved = {
      root: appRoot,
      base: "/",
      environments: { client: { build: { outDir: "out/client" } } },
    } as unknown as ResolvedConfig
    for (const plugin of emitters) {
      // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
      await (plugin.configResolved as any)?.call({}, resolved)
    }
    for (const plugin of emitters) await runBuildApp(plugin)

    return { clientDir, names: plugins.map((plugin) => plugin.name) }
  }

  it("a web spa build ships all four", async () => {
    const { clientDir, names } = await emitFor("web")
    expect(names).toContain("adaptv:static-host")
    for (const name of HOST_FILES)
      expect(existsSync(path.join(clientDir, name))).toBe(true)
  }, 30_000)

  it("a capacitor build of the same app ships none, though it is render: spa too", async () => {
    //the bug this pins: every `.ipa`/`.apk` carried `_redirects`, `404.html` and
    //`.nojekyll`, answering to an HTTP host the WebView does not have
    const { clientDir, names } = await emitFor("capacitor")
    expect(names).not.toContain("adaptv:static-host")
    expect(names).toContain("adaptv:native-bundle")
    for (const name of HOST_FILES)
      expect(existsSync(path.join(clientDir, name))).toBe(false)
    //the shell itself stays: it is the document the WebView boots
    expect(existsSync(path.join(clientDir, "index.html"))).toBe(true)
  }, 30_000)
})

function flatten(options: PluginOption[]): Plugin[] {
  const out: Plugin[] = []
  for (const option of options) {
    if (!option) continue
    if (Array.isArray(option)) out.push(...flatten(option))
    else if (typeof option === "object" && "name" in option)
      out.push(option as Plugin)
  }
  return out
}
