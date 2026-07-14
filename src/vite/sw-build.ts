import { existsSync, unlinkSync } from "node:fs"
import path from "node:path"
import { build as esbuild } from "esbuild"
import type { Plugin } from "vite"
import { injectManifest } from "workbox-build"
import {
  DEFAULT_SW_GLOB_IGNORES,
  DEFAULT_SW_GLOB_PATTERNS,
  DEFAULT_SW_MAX_FILE_BYTES,
} from "#nativ/config/sw-helpers.ts"
import { computeBuildTag, slugifyName } from "#nativ/vite/build-tag.ts"
import type { NativContext } from "#nativ/vite/nativ-context.ts"
import { requireAppConfig } from "#nativ/vite/nativ-context.ts"

const DEFAULT_SW_ENTRY = "./src/sw.ts"

/**
 * Production precache inject for the app-authored service worker.
 *
 * Runs on the SSR build's `closeBundle` (vite-plugin-pwa's own hook never fires
 * when every environment is `build.ssr`). Bundles `sw` with esbuild — injecting
 * the derived `__NATIV_BUILD_TAG__` so the worker's cache namespace tracks the
 * deployed assets — then stamps the workbox precache manifest into it.
 */
export function nativSwBuildPlugin(context: NativContext): Plugin {
  return {
    name: "nativ:sw-build",
    apply: "build",
    applyToEnvironment(environment) {
      return environment.name === "ssr"
    },
    async closeBundle() {
      const config = requireAppConfig(context)
      if (config.sw === false) return

      const swEntryRel =
        typeof config.sw === "string" ? config.sw : DEFAULT_SW_ENTRY
      const swEntry = path.resolve(context.appRoot, swEntryRel)
      const clientDir = path.resolve(context.appRoot, "dist/client")

      if (!existsSync(clientDir)) {
        throw new Error(
          `[nativ] ${clientDir} missing — the client build must finish before the service worker is generated`,
        )
      }
      if (!existsSync(swEntry)) {
        throw new Error(
          `[nativ] service worker entry not found: ${swEntry} (config.sw = ${JSON.stringify(config.sw)})`,
        )
      }

      const buildTag = await computeBuildTag(
        clientDir,
        slugifyName(config.name),
      )
      const swSrcBundle = path.join(clientDir, "sw-src.js")
      const swDest = path.join(clientDir, "sw.js")

      const bundleResult = await esbuild({
        entryPoints: [swEntry],
        outfile: swSrcBundle,
        format: "iife",
        target: "es2020",
        bundle: true,
        minify: true,
        define: {
          __NATIV_BUILD_TAG__: JSON.stringify(buildTag),
        },
      })

      if (bundleResult.errors.length > 0) {
        throw new Error(
          `[nativ] service worker bundle failed: ${bundleResult.errors.map((error) => error.text).join(", ")}`,
        )
      }

      const { warnings } = await injectManifest({
        swSrc: swSrcBundle,
        swDest,
        globDirectory: clientDir,
        globPatterns: [...DEFAULT_SW_GLOB_PATTERNS],
        globIgnores: [...DEFAULT_SW_GLOB_IGNORES, "sw-src.js", "sw.js"],
        maximumFileSizeToCacheInBytes: DEFAULT_SW_MAX_FILE_BYTES,
      })

      unlinkSync(swSrcBundle)

      for (const message of warnings) {
        console.warn(`[nativ] ${message}`)
      }

      console.log(`[nativ] wrote ${swDest} (build tag ${buildTag})`)
    },
  }
}
