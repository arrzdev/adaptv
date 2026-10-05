/**
 * `pnpm playground:setup` — make this worktree's playground runnable.
 *
 * Framework-development only; nothing here ships. Run automatically on the first
 * `pnpm dev:*` in a worktree that has no `playground/node_modules`, so the intended
 * experience is `git worktree add` → `pnpm dev:ios` and nothing in between.
 *
 * Two steps, idempotent: install, then build. The playground's own `pnpm install`,
 * whose `link:../../..` dependency then resolves to THIS worktree — the whole point of
 * vendoring it in-repo — and the framework's `dist/`, which that link's `exports` name.
 *
 * There is deliberately nothing else. The playground is a frontend-only app: no
 * API, no database to migrate, and no `env/.env` to copy across from the main
 * checkout (it reads no environment at all). Each of those used to be a step here,
 * and each was a way for a fresh worktree to come up subtly wrong.
 */
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { c, log, spacer } from "../bin/lib/render.mjs"
import { ensureDist } from "./ensure-dist.mjs"

const WORKTREE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const PLAYGROUND = path.join(WORKTREE, "playground")

function run(args, { cwd, label, fatal = true }) {
  const r = spawnSync("pnpm", args, { cwd, stdio: "inherit" })
  if (r.status === 0) return true
  if (fatal) {
    log.error(`${label} failed (exit ${r.status ?? "signal"}).`)
    process.exit(r.status ?? 1)
  }
  log.warn(`${label} failed — continuing (re-run it once it's fixed).`)
  return false
}

// ── install ─────────────────────────────────────────────────────────────────
// The framework's own deps first: the playground links it, and the CLI it runs from `bin/`
// resolves capacitor, sharp and workbox out of THIS worktree's node_modules.
if (!existsSync(path.join(WORKTREE, "node_modules"))) {
  log.info("installing framework deps…")
  run(["install"], { cwd: WORKTREE, label: "pnpm install (framework)" })
}
log.info("installing playground deps…")
run(["install"], { cwd: PLAYGROUND, label: "pnpm install (playground)" })

// ── build ───────────────────────────────────────────────────────────────────
// The app links this checkout and `exports` point at `dist/`, so it runs nothing until
// the framework is built.
if (
  !ensureDist(WORKTREE, { onBuild: () => log.info("building dist/…") })
) {
  log.error("pnpm build failed")
  process.exit(1)
}

spacer()
log.success("playground ready")
log.info(
  `${c.dim("run it with")} pnpm dev:ios ${c.dim("| dev:web | dev:all | preview:ios | build:ios")}`,
)
