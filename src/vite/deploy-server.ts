import type { Plugin, PluginOption } from "vite"

/**
 * The Vite environment the deploy plugin bundles the server into.
 *
 * Nitro builds it last, from inside its own `buildApp` post hook: the client and
 * SSR environments first, then it copies `public/` into the client output,
 * prerenders, and only then bundles this one. That bundle reads the client
 * output off disk as it goes — the node-server preset bakes every file it finds
 * into a public asset table, and the "inline" presets bake the bytes too. A file
 * written after this environment starts is on disk and served by nothing.
 */
export const DEPLOY_SERVER_ENVIRONMENT = "nitro"

/**
 * Hooks that write into the client output at the one moment that is right for
 * every build: once the output is complete, and before anything bakes it.
 *
 * With a server build that moment is the start of the deploy server's own
 * environment (`buildStart`), after Nitro has copied `public/` in — the
 * precache glob needs those files — and before its asset table is generated.
 * Without one (`render: "spa"`, the native lineage) nothing reads the output
 * inside the build, and `buildApp` at `order: "post"` is the moment instead.
 *
 * The handler runs once, whichever fires first. Several emitters using this run
 * in plugin-array order in both hooks, since Vite calls same-order `buildApp`
 * hooks in that order and the bundler runs `buildStart` hooks sequentially. The
 * deploy plugin must come before them in the array, so its `buildApp` post hook
 * (which builds that environment) runs before theirs.
 *
 * MEASURED, and the reason this exists: the emitters used to run only in
 * `buildApp` post, which is after Nitro's whole post hook. The node-server
 * build then answered 404 for `/sw.js` and `/adaptv-shell.html` — both on disk,
 * neither in the table — so an SSR app run with `node .output/server/index.mjs`
 * never installed its service worker. `vite preview` reads the directory, which
 * is why no suite saw it.
 */
export function emitIntoClientOutput(
  handler: () => Promise<void>,
): Pick<Plugin, "buildStart" | "buildApp"> {
  let emitted = false
  const emitOnce = async () => {
    if (emitted) return
    emitted = true
    await handler()
  }
  return {
    buildStart: {
      async handler() {
        if (this.environment?.name === DEPLOY_SERVER_ENVIRONMENT)
          await emitOnce()
      },
    },
    buildApp: {
      order: "post",
      async handler(builder) {
        //A server build that never reached `buildStart` above means the name no
        //longer matches Nitro's environment. Writing now would put both files
        //back outside its asset table — the bug this exists for, with a green
        //build — so fail the build instead.
        if (!emitted && builder?.environments?.[DEPLOY_SERVER_ENVIRONMENT])
          throw new Error(
            `[adaptv] the "${DEPLOY_SERVER_ENVIRONMENT}" server environment was built without the app shell and the service worker — they must be written before it`,
          )
        await emitOnce()
      },
    },
  }
}

/**
 * The server build — adaptv's, not the consumer's. → `docs/decisions/rendering-and-delivery.md §2`
 *
 * ## Why adaptv injects this at all
 *
 * A plain TanStack Start app picks its deploy target by **which Vite plugin the
 * developer puts in `vite.config.ts`** — Cloudflare's, Netlify's, or Nitro's.
 * There is no `target` key anywhere in Start's own options; the plugin *is* the
 * choice. That works, but it puts a mechanism the consumer never chose into the
 * one file adaptv otherwise keeps down to `[adaptv(), tailwindcss()]`, and it
 * makes "deploy anywhere" something the app has to re-learn per host.
 *
 * Injecting it here buys the property adaptv wants: **one config, no deploy
 * plugin, and the same build runs anywhere.**
 *
 * ## Why Nitro rather than a table of host plugins
 *
 * Nitro is the deploy layer Start itself delegates to, and it covers every host,
 * the two that also ship their own Vite plugin included. Crucially it **auto-detects
 * eight providers with zero configuration** — AWS Amplify, Azure, Cloudflare,
 * Firebase App Hosting, Netlify, Stormkit, Vercel, Zeabur — by reading the
 * platform's own build environment. Nothing is declared, so nothing can be
 * declared *wrong*, and a build that moves from one provider to another needs no
 * edit.
 *
 * For everything else the preset comes from `NITRO_PRESET` (or `SERVER_PRESET`),
 * which is what Nitro's own docs recommend for CI/CD. adaptv deliberately adds no
 * config key and no CLI flag on top: an adaptv enum could only ever be a narrower,
 * staler copy of ~20 upstream presets, and `--host` already means Vite's bind
 * address on `adaptv dev web`.
 *
 * The alternative — one optional peer dependency per host, a resolution table and
 * a per-host verification matrix — was designed and rejected for that reason.
 *
 * ## The version is pinned on purpose
 *
 * `nitro` is pinned to an exact beta rather than a range. Beta is the deliberate
 * choice: adaptv is pre-alpha, so adopting the forward path now costs nothing,
 * while building against the legacy `@tanstack/nitro-v2-vite-plugin` would buy a
 * migration we would have to perform later on consumers' behalf. The pin is what
 * makes that safe — the beta cannot move under a build, and the bump is an
 * explicit, reviewable change.
 *
 * ⚠︎ The beta belongs to **UnJS, not TanStack**. A Start release does not
 * stabilise it, so do not wait for one.
 */
export async function adaptvDeployServerPlugins(
  render: "ssr" | "spa",
): Promise<PluginOption[]> {
  //A spa build has no server to produce: the output is a bucket of files and the
  //client router resolves the URL. Injecting a server builder here would emit a
  //handler nothing ever invokes — and on a static host there is nothing to invoke
  //it *with*. The static-host files (`static-host.ts`) are that build's deploy
  //story instead.
  if (render === "spa") return []

  //Imported dynamically so the module is only resolved for the builds that need
  //it, and so this file stays cheap to load in tests.
  const { nitro } = await import("nitro/vite")

  //No options. The preset is auto-detected from the build environment, or set by
  //`NITRO_PRESET` — see above. Anything adaptv passed here would override the
  //platform's own answer with a guess.
  return [nitro() as PluginOption]
}
