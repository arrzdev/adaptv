import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

// The offline-page filename is declared in TWO places that can't share a module: the CLI
// GENERATES the file (bin/lib/offline-page.mjs, plain Node) and the in-app watchdog
// NAVIGATES to it (src/shell/native-live-reload-client.ts, framework TS bundled into the
// app). If they drift, the offline screen 404s and the "dev server down" recovery is dead
// with no error. This test is the seam that keeps the two literals in lockstep.

// `pnpm test` runs from the package root, so cwd is the repo root. (import.meta.url is
// not a file: URL under the happy-dom test environment, so it can't be used here.)
const REPO_ROOT = process.cwd()

function extractOfflinePageConst(relPath: string): string {
  const text = readFileSync(path.join(REPO_ROOT, relPath), "utf8")
  const m = text.match(/OFFLINE_PAGE\s*=\s*"([^"]+)"/)
  if (!m) throw new Error(`OFFLINE_PAGE constant not found in ${relPath}`)
  return m[1]
}

describe("OFFLINE_PAGE filename", () => {
  it("matches between the CLI generator and the in-app watchdog", () => {
    const generator = extractOfflinePageConst("bin/lib/offline-page.mjs")
    const watchdog = extractOfflinePageConst(
      "src/shell/native-live-reload-client.ts",
    )
    expect(watchdog).toBe(generator)
  })
})
