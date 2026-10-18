/*
 * Writes `/version.json` into the client build, next to the prerendered pages, so the
 * Worker serves it as a static file. What it holds: `src/utils/build-sha.ts`.
 */
import { execSync } from "node:child_process"
import type { Plugin } from "vite"
import { buildSha, versionFile } from "../src/utils/build-sha"

export function buildShaFile(): Plugin {
  return {
    name: "website:build-sha-file",
    apply: "build",
    applyToEnvironment: (environment) => environment.name === "client",
    generateBundle() {
      const sha = buildSha(process.env, () =>
        execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim(),
      )
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: versionFile(sha),
      })
    },
  }
}
