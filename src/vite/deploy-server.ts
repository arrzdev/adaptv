import type { PluginOption } from "vite"

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
