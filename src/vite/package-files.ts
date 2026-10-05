import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Where adaptv finds its own files, in whichever layout it runs from.
 *
 * A fixed `../..` from `import.meta.url` only holds in `src/vite/`. The same code
 * runs bundled into `dist/vite.mjs` (or a shared chunk next to it) once the package ships
 * built, and as `dist/cli/<dir>/<module>.mjs` when the CLI loads it — where `../..` lands
 * above the package, or on `dist/`. So the root is found by walking up to the
 * `package.json` that names adaptv, and the layout is the folder this module sits in below
 * it. → docs/roadmap/dist-cutover.md
 *
 * Every function here throws under a non-`file:` `import.meta.url` (vitest can serve one,
 * and the CLI bundles checkout modules into `data:` URLs). Call them lazily, never at
 * module scope; callers that run under either keep their own fallback.
 */

const PACKAGE_NAME = "@arrzdev/adaptv"

/**
 * The modules adaptv hands to the consumer's own build, which compiles them as part of the
 * app: Start's client and router entries, the root route the route DSL points at, the
 * service worker esbuild bundles, and the boot screen prerendered into the shell. In a
 * checkout they are source; in a published package each is its own tsdown entry, so the
 * consumer gets the same file the framework's own entries share chunks with.
 * → tsdown.config.ts
 */
export const SHIPPED_FILES = {
  "client-entry": {
    src: "src/routes/client-entry.tsx",
    dist: "dist/client-entry.mjs",
  },
  "router-entry": {
    src: "src/routes/router-entry.tsx",
    dist: "dist/router-entry.mjs",
  },
  "root-route": {
    src: "src/routes/root-route.tsx",
    dist: "dist/root-route.mjs",
  },
  "default-worker": {
    src: "src/sw/default-worker.ts",
    dist: "dist/default-worker.mjs",
  },
  "boot-error": {
    src: "src/components/boot-error.tsx",
    dist: "dist/boot-error.mjs",
  },
} as const

export type ShippedFile = keyof typeof SHIPPED_FILES

export type PackageLayout = { root: string; layout: "src" | "dist" }

const cache = new Map<string, PackageLayout>()

/**
 * adaptv's package root and the layout `modulePath` runs from.
 *
 * @param modulePath defaults to this module; a test hands in a path inside a fixture.
 * @throws when no `package.json` above `modulePath` names adaptv.
 */
export function adaptvPackage(
  modulePath: string = fileURLToPath(import.meta.url),
): PackageLayout {
  const hit = cache.get(modulePath)
  if (hit) return hit
  let dir = path.dirname(modulePath)
  for (;;) {
    if (namesAdaptv(path.join(dir, "package.json"))) {
      const top = path.relative(dir, modulePath).split(path.sep)[0]
      const found: PackageLayout = {
        root: dir,
        layout: top === "dist" ? "dist" : "src",
      }
      cache.set(modulePath, found)
      return found
    }
    const parent = path.dirname(dir)
    if (parent === dir)
      throw new Error(
        `[adaptv] no ${PACKAGE_NAME} package.json above ${modulePath}`,
      )
    dir = parent
  }
}

function namesAdaptv(file: string): boolean {
  try {
    return JSON.parse(readFileSync(file, "utf8")).name === PACKAGE_NAME
  } catch {
    return false
  }
}

/** adaptv's own package root. */
export function adaptvPackageRoot(): string {
  return adaptvPackage().root
}

/** The absolute path of one of the modules the consumer's build compiles. */
export function adaptvShippedFile(
  file: ShippedFile,
  { root, layout }: PackageLayout = adaptvPackage(),
): string {
  return path.join(root, SHIPPED_FILES[file][layout])
}
