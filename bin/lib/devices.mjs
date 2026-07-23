// Device targeting for `adaptv dev`. adaptv owns device selection (rather than letting
// Capacitor's opaque picker handle it) so it can CACHE the choice: pick once with the
// arrow keys, then `--latest` reuses it. The cache lives in `.adaptv/devices.json`
// (git-ignored with the rest of `.adaptv/`). → plan Part 3.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { capture } from "./exec.mjs"
import { ADAPTV_DIR, capCmd } from "./native.mjs"
import { log, select } from "./render.mjs"

const cacheFile = (appRoot) =>
  path.join(appRoot, ADAPTV_DIR, "devices.json")

function readCache(appRoot) {
  try {
    return JSON.parse(readFileSync(cacheFile(appRoot), "utf8"))
  } catch {
    return {}
  }
}

function writeCache(appRoot, platform, device) {
  const cache = readCache(appRoot)
  cache[platform] = device
  mkdirSync(path.join(appRoot, ADAPTV_DIR), { recursive: true })
  writeFileSync(cacheFile(appRoot), `${JSON.stringify(cache, null, 2)}\n`)
}

/**
 * List runnable targets via `cap run <platform> --list --json`. Capacitor emits a
 * clean `[{ name, api, id }]` array on stdout (logs go to stderr). Entries without a
 * usable id are dropped.
 */
export async function listTargets(appRoot, platform, env) {
  const { cmd, pre } = capCmd(appRoot)
  const { stdout } = await capture(
    cmd,
    [...pre, "run", platform, "--list", "--json"],
    { cwd: appRoot, env },
  )
  let parsed
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    const match = stdout.match(/\[[\s\S]*\]/)
    parsed = match ? JSON.parse(match[0]) : []
  }
  return (Array.isArray(parsed) ? parsed : []).filter(
    (t) => t?.id && t.id !== "?",
  )
}

/** Present the branded picker for a fresh list; caches + returns `{ id, name }`. */
async function pickAndCache(appRoot, platform, env) {
  const targets = await listTargets(appRoot, platform, env)
  if (targets.length === 0) {
    throw new Error(
      `no ${platform} devices or simulators found. Boot a simulator/emulator (or connect a device) and try again.`,
    )
  }
  const id = await select(
    `Choose a ${platform} device`,
    targets.map((t) => ({ value: t.id, label: t.name, hint: t.api })),
  )
  const device = { id, name: targets.find((t) => t.id === id)?.name ?? id }
  writeCache(appRoot, platform, device)
  return { ...device, source: "picked" }
}

/**
 * Resolve the target device for a run, honouring precedence:
 *   1. `--target <id>` → use it (and remember it)
 *   2. `--latest`      → the cached device; falls back to the picker if none
 *   3. otherwise       → the interactive picker
 * Returns `{ id, name, source }` where source is "target" | "latest" | "picked".
 */
export async function resolveTarget(
  appRoot,
  platform,
  env,
  { target, latest },
) {
  if (target) {
    const known = (await listTargets(appRoot, platform, env)).find(
      (t) => t.id === target,
    )
    // Validate BEFORE caching — otherwise a typo'd `--target` gets remembered and every
    // later `--latest` fails against a device that was never real.
    if (!known) {
      throw new Error(
        `unknown ${platform} device "${target}". Run \`adaptv dev ${platform}\` to pick from the current list.`,
      )
    }
    const device = { id: target, name: known.name ?? target }
    writeCache(appRoot, platform, device)
    return { ...device, source: "target" }
  }

  if (latest) {
    const cached = readCache(appRoot)[platform]
    // the "latest" tag is surfaced on the launch line, not as its own log line.
    if (cached?.id) return { ...cached, source: "latest" }
    log.warn(
      `${platform}: no cached device yet — pick one (it'll be remembered).`,
    )
  }

  return pickAndCache(appRoot, platform, env)
}
