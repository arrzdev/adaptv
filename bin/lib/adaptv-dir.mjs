/**
 * The hidden, git-ignored directory adaptv generates into.
 *
 * Its own module purely to break an import cycle: `fingerprint.mjs` needs the name in order to
 * skip the directory while walking, and `native.mjs` needs the fingerprint to decide whether
 * the launcher icons are already the ones on disk. One constant is the cheapest thing to move.
 *
 * Mirrors `src/vite/adaptv-dir.ts` — kept in sync by hand, because the vite side cannot import
 * from `bin/`.
 */
export const ADAPTV_DIR = ".adaptv"
