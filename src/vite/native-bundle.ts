import { existsSync, rmSync } from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import {
  captureClientOutDir,
  requireAppConfig,
  requireClientOutDir,
} from "#adaptv/vite/adaptv-context.ts"
import { CAPACITOR_WEB_DIR } from "#adaptv/vite/capacitor-config.ts"
import { defaultIconFiles, resolveIconSet } from "#adaptv/vite/icon-set.ts"

/**
 * Drop what only a browser tab could read from the native bundle.
 *
 * The native lineage is a normal client build — same Vite, same `public/` copy —
 * so it inherits every asset the web build emits for browser chrome. Inside a
 * WebView loading files off the device there is no tab, no bookmark, no address
 * bar and no install prompt, so those assets are never requested by anything:
 * they are weight in an `.ipa`/`.apk` and nothing else. On the playground they
 * were **1.3 MB of a 4.5 MB bundle**.
 *
 * It runs as a prune rather than as an exclusion because Vite's `public/` copy is
 * all-or-nothing (`copyPublicDir`), and turning it off would take the app's real
 * assets with it. Registered ONLY on the capacitor target — the plugin does not
 * exist on a web build, so there is no gate here to get wrong later.
 *
 * The mirror image of `static-host.ts`, which emits the files a static HTTP host
 * needs onto the web lineage and used to emit them here too. → `adaptv-plugin.ts`
 */
export function adaptvNativeBundlePlugin(context: AdaptvContext): Plugin {
  return {
    name: "adaptv:native-bundle",
    apply: "build",
    //Send this lineage somewhere of its own. Set on the CLIENT ENVIRONMENT, not
    //as a plugin-level `build.outDir` — that one is overridden by the framework
    //plugin, which is what the note on `CAPACITOR_WEB_DIR` used to record as a
    //dead end. The environment-level value survives, and `captureClientOutDir`
    //below reads back whatever actually won, so the emitters never assume.
    //The CLIENT environment only, and that is not an omission. Moving the `ssr`
    //one too was tried and REVERTED: the prerender boots the freshly built server
    //to crawl the routes, and from a relocated `outDir` every request came back
    //`Internal Server Error` — `Failed to fetch /`, zero pages prerendered, a
    //failed build. `dist/server` stays where the framework plugin puts it. It is
    //scratch that nothing syncs, so both lineages sharing it costs nothing; the
    //directory that SHIPS is the one that had to stop being shared.
    config() {
      return {
        environments: {
          client: { build: { outDir: CAPACITOR_WEB_DIR } },
        },
      }
    },
    configResolved(resolved) {
      captureClientOutDir(context, resolved)
    },
    //`buildApp`, `order: "post"`, and registered AFTER the three emitters — this
    //deletes things they read. `shell-emit` in particular reads
    //`.vite/manifest.json` out of the client dir, so pruning it any earlier would
    //take the shell's asset tags with it.
    buildApp: {
      order: "post",
      async handler() {
        pruneNativeBundle(context)
      },
    },
  }
}

/**
 * `.vite/manifest.json` — Vite's source-to-chunk map. It exists so a **server**
 * can resolve which chunks a route needs and emit preload tags for them; a static
 * SPA has those tags baked into the document it ships. Nothing fetches it on
 * device, and it describes the whole build graph, which is not something to
 * ship inside an app bundle either.
 */
const BUILD_METADATA_DIR = ".vite"

function pruneNativeBundle(context: AdaptvContext): void {
  const clientDir = requireClientOutDir(context)
  if (!existsSync(clientDir)) return

  const dropped: string[] = []

  //The icon art, at whatever URL it is actually served from — the app's own
  //directory under `public/`, or adaptv's default set. Resolved through the same
  //helper the head links and the manifest use, so this can never delete a
  //directory they still point at.
  //
  //Deleting the FILES is only half of it: the head links and the manifest's
  //`icons` array are suppressed for this target at their source (see
  //`root-route-module.ts` and `manifest.ts`), so the bundle carries no reference
  //to what was removed. Dangling `<link rel="icon">` tags would cost a burst of
  //404s inside the WebView on every cold launch.
  //
  //Launcher icons are unaffected. Those are generated into the native project
  //from the SOURCE directory by the CLI (`bin/lib/icons.mjs`), never from the
  //client output — this is the web copy of the same art, which the WebView has no
  //surface to display.
  const icons = resolveIconSet(
    context.appRoot,
    requireAppConfig(context),
    defaultIconFiles(),
  )
  if (icons.urlBase) dropped.push(icons.urlBase.replace(/^\//, ""))
  dropped.push(BUILD_METADATA_DIR)

  const removed = dropped.filter((rel) => remove(clientDir, rel))
  if (removed.length > 0) {
    console.log(
      `[adaptv] native bundle: dropped ${removed.join(", ")} (browser-only)`,
    )
  }
}

/**
 * Delete `rel` from inside `clientDir`, and refuse anything that is not strictly
 * inside it. The paths come from resolved config rather than from a literal, so
 * the containment check is the difference between a prune and an `rm -rf` at
 * whatever an `icons` key happens to point at.
 */
function remove(clientDir: string, rel: string): boolean {
  const target = path.resolve(clientDir, rel)
  const inside = path
    .relative(clientDir, target)
    .split(path.sep)
    .every((seg) => seg !== "" && seg !== "..")
  if (!inside || !existsSync(target)) return false
  rmSync(target, { recursive: true, force: true })
  return true
}
