import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

/**
 * Service-worker cache namespace, derived once per production build. Replaces a
 * hand-bumped constant: a content hash of the client bundle changes exactly when
 * the deployable assets change, so caches invalidate on real deploys and never
 * on a no-op rebuild. `NATIV_BUILD_TAG` overrides it (e.g. to pin across a
 * multi-worker deploy).
 */
export async function computeBuildTag(
  clientDir: string,
  slug: string,
): Promise<string> {
  const override = process.env.NATIV_BUILD_TAG
  if (override) return override

  const files = await collectFiles(clientDir)
  files.sort()

  const hash = createHash("sha256")
  for (const file of files) {
    //skip the service worker itself — it is written after this runs, and its
    //own contents include the manifest we are hashing toward (would self-alter).
    if (file === "sw.js" || file === "sw-src.js") continue
    const contents = await readFile(path.join(clientDir, file))
    hash.update(file)
    hash.update("\0")
    hash.update(contents)
    hash.update("\0")
  }

  return `${slug}-${hash.digest("hex").slice(0, 12)}`
}

async function collectFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  await walk(dir, dir, out)
  return out
}

async function walk(
  root: string,
  dir: string,
  out: string[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(root, abs, out)
      continue
    }
    if (entry.isFile()) out.push(path.relative(root, abs))
  }
}

/** Slug for cache namespacing — lowercase, alnum, single dashes. */
export function slugifyName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "app"
  )
}
