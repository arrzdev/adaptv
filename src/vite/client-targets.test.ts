// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { PluginOption } from "vite"
import { resolveConfig } from "vite"
import { afterEach, describe, expect, it } from "vitest"
import { adaptv } from "#adaptv/vite/adaptv-plugin.ts"
import { MIN_ANDROID_WEBVIEW } from "#adaptv/vite/capacitor-config.ts"
import { CLIENT_BUILD_TARGETS } from "#adaptv/vite/client-targets.ts"

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/**
 * The smallest app `adaptv()` will configure: a config, a stylesheet and an empty
 * routes folder. `render: "spa"` keeps the server-build plugins out of the graph,
 * and both lineages resolve that way anyway (the capacitor one always does).
 */
function scaffold(): string {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-targets-"))
  roots.push(appRoot)
  mkdirSync(path.join(appRoot, "src/routing"), { recursive: true })
  mkdirSync(path.join(appRoot, "src/styles"), { recursive: true })
  writeFileSync(path.join(appRoot, "src/styles/main.css"), "")
  //A real route config, because the route generator loads it while the config
  //resolves. By absolute path: a temp dir has no node_modules to find adaptv in.
  const routesDsl = fileURLToPath(
    new URL("../routes/adaptv-routes.ts", import.meta.url),
  )
  writeFileSync(
    path.join(appRoot, "src/routing/config.ts"),
    `import { rootRoute } from ${JSON.stringify(routesDsl)}\nexport const routes = rootRoute([])\n`,
  )
  writeFileSync(
    path.join(appRoot, "adaptv.config.ts"),
    `export default {
      appId: "dev.arrz.targets",
      name: "Targets",
      description: "fixture",
      themeColor: { light: "#eeeeec" },
      styles: "./src/styles/main.css",
      render: "spa",
      router: { routesDirectory: "./routing" },
    }\n`,
  )
  return appRoot
}

/** The config Vite actually builds with, after every plugin in the lineage has had its say. */
async function resolveBuild(target: "web" | "capacitor") {
  const appRoot = scaffold()
  const plugins = await adaptv({ appRoot, target })
  return resolveConfig(
    {
      configFile: false,
      root: appRoot,
      logLevel: "silent",
      plugins: plugins as PluginOption[],
    },
    "build",
    "production",
  )
}

describe("client build targets", () => {
  it.each(["web", "capacitor"] as const)(
    "the %s lineage compiles its client for the declared engines, JS and CSS alike",
    async (target) => {
      const resolved = await resolveBuild(target)
      const client = resolved.environments.client?.build
      expect(client?.target).toEqual(CLIENT_BUILD_TARGETS)
      expect(client?.cssTarget).toEqual(CLIENT_BUILD_TARGETS)
      //The one the CSS minifier actually reads. It is a single plugin instance
      //built from the top-level config and shared across environments, so the
      //environment's own value above never reaches Lightning CSS on its own.
      expect(resolved.build.cssTarget).toEqual(CLIENT_BUILD_TARGETS)
    },
  )

  it("leaves every other environment's JS target where it was", async () => {
    const resolved = await resolveBuild("web")
    //the server build runs on Node; a top-level `build.target` would reach it
    expect(Object.keys(resolved.environments)).toContain("ssr")
    for (const [name, env] of Object.entries(resolved.environments)) {
      if (name === "client") continue
      expect(env.build.target, name).not.toEqual(CLIENT_BUILD_TARGETS)
    }
  })

  it("targets exactly the Android WebView the native gate lets boot", () => {
    //Chromium entries are the WebView's; compiling above the gate breaks devices
    //it admits, compiling below it pays for devices it refuses.
    const chromium = CLIENT_BUILD_TARGETS.filter((t) =>
      t.startsWith("chrome"),
    )
    expect(chromium).toEqual([`chrome${MIN_ANDROID_WEBVIEW}`])
  })

  it("stays at iOS 15.4, the first WebKit that parses Tailwind's @layer", () => {
    expect(CLIENT_BUILD_TARGETS).toContain("safari15.4")
    expect(CLIENT_BUILD_TARGETS).toContain("ios15.4")
    //an `es20xx` entry is mapped to OLD browser versions on the CSS side too
    expect(CLIENT_BUILD_TARGETS.some((t) => /^es\d/.test(t))).toBe(false)
  })
})
