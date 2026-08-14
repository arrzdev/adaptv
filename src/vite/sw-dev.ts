import { existsSync } from "node:fs"
import path from "node:path"
import { build as esbuild } from "esbuild"
import type { Plugin } from "vite"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { requireAppConfig } from "#adaptv/vite/adaptv-context.ts"

/**
 * Opt-in: serve the app's OWN service-worker modules in `dev`.
 *
 * Set `ADAPTV_DEV_SW=1`. Off by default, and it has to be — dev is SW-free on
 * purpose (`service-worker-shell.ts`), because a worker registered here serves a
 * stale bundle back into the next session and breaks hot reload.
 */
export const DEV_SW_ENV = "ADAPTV_DEV_SW"

/** Whether the escape hatch is armed for this process. */
export function devServiceWorkerEnabled(): boolean {
  const value = process.env[DEV_SW_ENV]
  return value !== undefined && value !== "" && value !== "0"
}

/** Where the dev worker is served. Same path as the built one, deliberately. */
const DEV_SW_PATH = "/sw.js"

/**
 * The dev worker is the app's modules and **nothing else**. → `RENDERING.md §3`
 *
 * Not a dev build of adaptv's worker, and this is the whole design. adaptv's
 * worker is precache + navigation + static-asset delivery, and none of the three
 * can exist in dev: the precache manifest is globbed from the client OUTPUT
 * directory, which no dev server has; the build tag that namespaces every runtime
 * cache and drives the activate sweep is computed from that same output; and a
 * CacheFirst route pointed at Vite's dev URLs caches modules HMR is about to
 * replace. Shipping a degraded lookalike would mean testing something that does
 * not exist in production, which is worse than testing nothing.
 *
 * What an app's own modules do — `onAppMessage`, `sendToApp`, push, background
 * sync — has no dependency on any of that, so it is exactly the part that CAN be
 * exercised without a build. That is what this serves, and its absence was a real
 * gap: verifying a `serviceWorkers: []` module used to require a full production
 * build plus `vite preview`.
 *
 * Rebundled per request (no cache) so an edit is one reload away, and it applies
 * itself immediately rather than waiting a launch. Both are deliberate departures
 * from the shipped worker: the production update policy exists to protect unsaved
 * work in a live session, and there is none of that to protect here.
 */
export function adaptvSwDevPlugin(context: AdaptvContext): Plugin {
  return {
    name: "adaptv:sw-dev",
    apply: "serve",
    configureServer(server) {
      if (!devServiceWorkerEnabled()) return

      const modules = requireAppConfig(context).serviceWorkers ?? []
      if (modules.length === 0) {
        //Nothing to serve, and saying so beats a silent 404 on a flag the dev
        //deliberately set — the config is the thing that is empty, not the flag.
        server.config.logger.warn(
          `[adaptv] ${DEV_SW_ENV} is set but \`serviceWorkers: []\` is empty — no dev worker to serve`,
        )
        return
      }

      server.middlewares.use((req, res, next) => {
        if ((req.url ?? "").split("?")[0] !== DEV_SW_PATH) return next()
        void (async () => {
          try {
            const source = await bundleDevWorker(context, modules)
            res.setHeader("Content-Type", "text/javascript")
            //The SW script itself must never come from HTTP cache, or an edit
            //stays invisible for as long as the browser feels like it.
            res.setHeader("Cache-Control", "no-store")
            res.end(source)
          } catch (error) {
            //A broken app worker must not take the dev server down with it. 500
            //with the real message: registration fails, the page still loads,
            //and the reason is in the network tab.
            res.statusCode = 500
            res.setHeader("Content-Type", "text/javascript")
            res.end(
              `/* adaptv dev worker failed to build */\nconsole.error(${JSON.stringify(
                String((error as Error)?.message ?? error),
              )})`,
            )
          }
        })()
      })
    },
  }
}

async function bundleDevWorker(
  context: AdaptvContext,
  serviceWorkers: string[],
): Promise<string> {
  const resolved = serviceWorkers.map((entry) => {
    const absolute = path.resolve(context.appRoot, entry)
    if (!existsSync(absolute)) {
      throw new Error(
        `serviceWorkers: "${entry}" does not exist (resolved to ${absolute})`,
      )
    }
    return absolute
  })

  const result = await esbuild({
    stdin: {
      contents: [
        ...resolved.map((module) => `import ${JSON.stringify(module)}`),
        //Take over on the spot. The shipped worker deliberately waits for the
        //next launch; here an edit that needs two reloads to show up would just
        //read as the change not working.
        "self.addEventListener('install', () => self.skipWaiting())",
        "self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))",
        "",
      ].join("\n"),
      resolveDir: context.appRoot,
      loader: "ts",
    },
    format: "iife",
    target: "es2020",
    bundle: true,
    write: false,
    //Same reason as the production bundle: a worker IS side effects, and
    //`sideEffects` in adaptv's package.json would let esbuild drop the imports.
    ignoreAnnotations: true,
  })

  const source = result.outputFiles?.[0]?.text
  if (!source) throw new Error("dev worker bundle produced no output")
  return source
}
