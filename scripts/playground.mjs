/**
 * `pnpm dev:ios` (and friends) — run the playground app's own scripts.
 *
 * Framework-development only. Nothing here ships: `playground/` and `scripts/` are not in
 * `package.json#files`, no source imports either, and a consumer never sees them.
 *
 * `playground/` is a copy of a real app (chopchop's `adaptv-testing` branch) vendored into
 * THIS repo, git and all — its history is adaptv's history. That single fact removes every
 * moving part the earlier designs needed:
 *
 *   · a worktree gets its own playground for free, checked out with the branch, so two
 *     worktrees can migrate the same API differently without meeting;
 *   · the app's committed `"@arrzdev/adaptv": "link:../../.."` resolves to the checkout it
 *     sits in — whichever worktree that is — so nothing repoints anything, ever;
 *   · a framework change and the consumer change it forces land in ONE commit, one diff,
 *     one review. No second repo, no branch pairing, no syncing.
 *
 * It is deliberately allowed to drift from the real chopchop. It is an EXAMPLE, kept only
 * as honest as it needs to be to exercise the framework; the real migration happens once,
 * against real chopchop, when the framework is ready.
 *
 * This script is a passthrough and nothing else. The playground is a turbo monorepo that
 * already knows how to bring itself up — `dev:ios` starts the API beside the app, frees its
 * ports, and gates on env — and re-implementing any of that here would be a second, subtly
 * different way to start the same app.
 *
 * Ports: freed by the playground's own `runDev`, never here and never by the CLI, which
 * passes `--strictPort` and fails loudly on a busy port on purpose (bin/lib/dev-server.mjs).
 * A framework dev hopping worktrees wants the old server gone; a real user wants to be told.
 * Both are right, and only one of them is the product.
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { log } from "../bin/lib/render.mjs"

const WORKTREE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const PLAYGROUND = path.join(WORKTREE, "playground")
const SETUP = path.join(WORKTREE, "scripts", "playground-setup.mjs")

const args = process.argv.slice(2)

function die(message, ...hints) {
  log.error(message)
  for (const h of hints) log.info(h)
  process.exit(1)
}

const scripts = (() => {
  try {
    return (
      JSON.parse(
        readFileSync(path.join(PLAYGROUND, "package.json"), "utf8"),
      ).scripts ?? {}
    )
  } catch {
    die(
      "playground/ has no package.json — the vendored app is missing.",
      "it is committed to this repo; a clean checkout should have it.",
    )
  }
})()

if (!scripts[args[0]]) {
  die(
    `playground has no "${args[0]}" script.`,
    `it owns these commands — add it in playground/package.json first. (has: ${Object.keys(
      scripts,
    )
      .filter((s) => /^(dev|preview|build):/.test(s))
      .join(", ")})`,
  )
}

// First run in a fresh worktree: the playground needs its own install, env files and local
// D1 before any of this works. Doing it here rather than making the dev remember a setup
// step is the entire promise — `git worktree add`, `pnpm dev:ios`, done.
if (!existsSync(path.join(PLAYGROUND, "node_modules"))) {
  const r = spawnSync(process.execPath, [SETUP], { stdio: "inherit" })
  if (r.status !== 0) process.exit(r.status ?? 1)
} else if (installStale()) {
  // The lockfile moved and `node_modules` did not. `existsSync` above only ever asked whether
  // there was an install, never whether it was the RIGHT one, and nothing else asks either:
  // pnpm's own pre-run check runs for the project it is invoked in, which is this repo, not
  // the separate pnpm project under `playground/`. So a `git pull` that bumps a playground
  // dependency leaves an install from before the bump and the first symptom is the app.
  //
  // It cost a real afternoon. A @tanstack bump landed on main; `playground/node_modules` stayed
  // three weeks old; the app's SSR entry resolved an old `start-server-core` against the new
  // vite plugin beside it and threw `Cannot find module
  // 'tanstack-start-injected-head-scripts:v'` on every request. Nothing in the chain mentioned
  // dependencies. Four seconds of `pnpm install` here is the whole fix.
  log.info("playground deps are behind its lockfile, installing…")
  const r = spawnSync("pnpm", ["install"], {
    cwd: PLAYGROUND,
    stdio: "inherit",
  })
  if (r.status !== 0) {
    die(
      "playground install failed.",
      "run 'pnpm install' in playground/ to see why.",
    )
  }
}

/**
 * Is the install older than the lockfile it was built from? pnpm writes the lockfile it
 * resolved into `node_modules/.pnpm/lock.yaml`, byte for byte, so comparing the two answers
 * exactly the question pnpm itself would ask. Unreadable either way means there is nothing to
 * compare and nothing to claim: say no rather than reinstalling on a hunch.
 */
function installStale() {
  try {
    return (
      readFileSync(
        path.join(PLAYGROUND, "node_modules", ".pnpm", "lock.yaml"),
        "utf8",
      ) !== readFileSync(path.join(PLAYGROUND, "pnpm-lock.yaml"), "utf8")
    )
  } catch {
    return false
  }
}

// Cheap assertion, no mutation: the link must resolve INTO this worktree. It can't drift on
// its own (the spec is relative), but a `node_modules` copied in from elsewhere would point at
// another checkout, and every symptom after that reads as "my change did nothing".
try {
  const linked = realpathSync(
    path.join(
      PLAYGROUND,
      "apps",
      "frontend",
      "node_modules",
      "@arrzdev",
      "adaptv",
    ),
  )
  if (linked !== realpathSync(WORKTREE)) {
    log.warn(
      `playground is linked to ${linked}, not this checkout — pnpm playground:setup`,
    )
  }
} catch {
  // no link yet (a package that doesn't declare it, or a partial install) — the run will say so
}

// `--silent` because this is a PASSTHROUGH and pnpm's own chatter is not part of the command
// the dev ran. Without it, one failed `pnpm adaptv gen icons …` ended in four lines nobody
// wrote — the script echo, the resolved command with every argument re-quoted, the app's
// absolute path, and `ELIFECYCLE Command failed with exit code 1` — under a CLI whose entire
// contract is that a user error is ONE terse line (R7). The child's own stdout is untouched:
// `--silent` suppresses pnpm's lifecycle reporter, not the process it starts.
const child = spawn("pnpm", ["run", "--silent", ...args], {
  cwd: PLAYGROUND,
  stdio: "inherit",
})
// Ctrl-C reaches the child directly (same process group) and turbo owns its own teardown —
// a handler here would only race it.
process.on("SIGINT", () => {})
process.on("SIGTERM", () => child.kill("SIGTERM"))
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)))
