import { existsSync, unlinkSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build as esbuild } from "esbuild"
import type { Plugin } from "vite"
import { injectManifest } from "workbox-build"
import { resolvePrecacheDocuments } from "#nativ/config/precache-documents.ts"
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

      //The app's own worker wins if it wrote one; otherwise nativ's generated
      //worker in `.nativ/`. A normal app authors no service worker at all —
      //everything it would decide is already in nativ.config.ts.
      const explicit =
        typeof config.sw === "string"
          ? config.sw
          : typeof config.sw === "object"
            ? config.sw.entry
            : undefined
      const conventional = path.resolve(context.appRoot, DEFAULT_SW_ENTRY)
      //Falls back to nativ's OWN worker module — a real file in the package, not
      //a generated copy. Nothing in it is app-specific.
      const swEntry = explicit
        ? path.resolve(context.appRoot, explicit)
        : existsSync(conventional)
          ? conventional
          : fileURLToPath(
              new URL("../sw/default-worker.ts", import.meta.url),
            )
      const clientDir = path.resolve(context.appRoot, "dist/client")

      if (!existsSync(clientDir)) {
        throw new Error(
          `[nativ] ${clientDir} missing — the client build must finish before the service worker is generated`,
        )
      }
      if (!existsSync(swEntry)) {
        throw new Error(
          `[nativ] service worker entry not found: ${swEntry}`,
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
          //the render mode the app was actually built with
          __NATIV_RENDER_MODE__: JSON.stringify(
            context.web?.render ?? "ssr",
          ),
        },
      })

      if (bundleResult.errors.length > 0) {
        throw new Error(
          `[nativ] service worker bundle failed: ${bundleResult.errors.map((error) => error.text).join(", ")}`,
        )
      }

      //Documents are excluded from the default glob and re-added ONLY from the
      //explicit allowlist. `**/*.html` would sweep in every prerendered route —
      //including personalized ones — which is precisely the cross-user leak the
      //allowlist exists to prevent. → RENDERING.md §3.2
      const precacheDocuments = resolvePrecacheDocuments(
        typeof config.sw === "object" && config.sw !== null
          ? config.sw.precacheDocuments
          : undefined,
      )

      const { warnings } = await injectManifest({
        swSrc: swSrcBundle,
        swDest,
        globDirectory: clientDir,
        globPatterns: [
          ...DEFAULT_SW_GLOB_PATTERNS.map((pattern) =>
            pattern.replace(",html", ""),
          ),
          ...precacheDocuments,
        ],
        globIgnores: [...DEFAULT_SW_GLOB_IGNORES, "sw-src.js", "sw.js"],
        maximumFileSizeToCacheInBytes: DEFAULT_SW_MAX_FILE_BYTES,
      })

      if (precacheDocuments.length > 0) {
        console.log(
          `[nativ] precaching ${precacheDocuments.length} document(s): ${precacheDocuments.join(", ")}`,
        )
      }

      unlinkSync(swSrcBundle)

      for (const message of warnings) {
        console.warn(`[nativ] ${message}`)
      }

      console.log(`[nativ] wrote ${swDest} (build tag ${buildTag})`)
    },
  }
}
