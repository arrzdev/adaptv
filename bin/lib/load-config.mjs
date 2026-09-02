// The app's `adaptv.config.ts`, loaded the only way a TypeScript file can be from a
// plain `node` process: bundled once with esbuild and imported as a `data:` URL. Every
// command reads its config through here — `preflight` for the run, `doctor` for the
// report, `icons` for where the set goes — so there is one definition of what a usable
// config is, and it lives outside the entry that dispatches them.
import { existsSync } from "node:fs"
import path from "node:path"
import { build as esbuild } from "esbuild"

export async function loadConfig(appRoot) {
  const configPath = path.join(appRoot, "adaptv.config.ts")
  if (!existsSync(configPath)) {
    throw new Error(
      `no adaptv.config.ts in ${appRoot}. Run from an app root.`,
    )
  }
  const result = await esbuild({
    entryPoints: [configPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    plugins: [
      {
        name: "externalize-dynamic-imports",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) =>
            args.kind === "dynamic-import" ? { external: true } : null,
          )
        },
      },
    ],
  })
  const source = result.outputFiles?.[0]?.text
  if (!source) throw new Error("failed to bundle adaptv.config.ts")
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  const mod = await import(url)
  const config = mod.default
  if (!config?.appId) {
    throw new Error("missing 'appId' in adaptv.config.ts")
  }
  return config
}
