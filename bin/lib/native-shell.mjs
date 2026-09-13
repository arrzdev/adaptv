// The CLI's half of the native-shell check: mint an id per native dev build, bake it into the
// generated native config, remember it with the run cache, and tell the dev server which id
// each platform expects. The framework's half — the verdict, the boot gate — lives in
// `src/shell/native-shell.ts`, which says why the whole thing exists.
import { randomBytes } from "node:crypto"
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ADAPTV_DIR } from "./adaptv-dir.mjs"

/**
 * The user-agent product token. Mirrors `NATIVE_SHELL_TOKEN` in `src/shell/native-shell.ts`;
 * `native-shell.test.mjs` fails if the two drift.
 */
export const SHELL_TOKEN = "adaptv-shell"

/** Mirrors `NATIVE_SHELL_ENDPOINT` in `src/shell/native-shell.ts`. */
export const SHELL_ENDPOINT = "/__adaptv/native-shell"

/** Mirrors `NATIVE_SHELLS_ENV` in `src/vite/native-shell-plugin.ts`. */
export const SHELLS_ENV = "ADAPTV_DEV_SHELLS"

/** Where the expected ids live for the length of one dev run. */
export const SHELLS_FILE = "dev-shells.json"

/** A fresh id for one native build: `<platform>-<8 hex>`. The platform is what the verdict keys on. */
export function newShellId(platform) {
  return `${platform}-${randomBytes(4).toString("hex")}`
}

/**
 * The shell id in a user agent, or `null`.
 *
 * Its SOURCE is embedded in the offline page (`String(shellIdFromUserAgent)`), so it has no free
 * variables. The framework has the same parser in TypeScript; the test runs both over the same
 * user agents.
 *
 * @param {string | null | undefined} userAgent
 * @returns {string | null}
 */
export function shellIdFromUserAgent(userAgent) {
  const m = /(?:^|\s)adaptv-shell\/([a-z]+-[0-9a-f]+)(?=\s|$)/.exec(
    userAgent || "",
  )
  return m ? m[1] : null
}

const isShellMark = (value) =>
  typeof value === "string" && value.startsWith(`${SHELL_TOKEN}/`)

/**
 * Bake `id` into the env-carried native config, as the platform's appended user agent.
 *
 * Per platform (`ios.appendUserAgent`, `android.appendUserAgent`), never the shared top-level
 * key: one dev run can rebuild iOS and reuse Android, and each native runtime reads its own key
 * before the shared one. adaptv's generated config sets no user agent of its own, so the value
 * is the mark alone.
 */
export function stampShellId(platform, id) {
  let config = {}
  try {
    config = JSON.parse(process.env.ADAPTV_CAPACITOR_CONFIG ?? "{}") ?? {}
  } catch {}
  config[platform] = {
    ...(config[platform] ?? {}),
    appendUserAgent: `${SHELL_TOKEN}/${id}`,
  }
  process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify(config)
}

/**
 * The env-carried config as `nativeFingerprint` hashes it: without any shell mark.
 *
 * The mark is a nonce, so hashing it would make every build look like a native change to the
 * next run and the installed app would never be reused. It is also shared state across lanes: a
 * `dev all` that rebuilds Android stamps `android.appendUserAgent` while iOS is deciding whether
 * its own install is current. What a build CONTAINS is the rest of the config; which build it is,
 * the run cache records next to the fingerprint.
 *
 * @param {string | undefined} json
 */
export function withoutShellMark(json) {
  if (!json) return json
  let config
  try {
    config = JSON.parse(json)
  } catch {
    return json
  }
  if (!config || typeof config !== "object") return json
  let marked = false
  for (const platform of ["ios", "android"]) {
    const block = config[platform]
    if (block && isShellMark(block.appendUserAgent)) {
      delete block.appendUserAgent
      marked = true
    }
  }
  //Unmarked configs hash byte for byte as they always did: `preview`, `build` and the update
  //channel fold this same fingerprint in, and none of them ever carries a mark.
  return marked ? JSON.stringify(config) : json
}

/**
 * Whether the app installed on the device can be reused as it is, from its run-cache entry.
 *
 * The same three facts the cache always checked — same dev URL, same native fingerprint, still
 * installed — plus one: the entry names the shell id it was built with. An install the CLI holds
 * no id for cannot be told apart from a stale one by the dev server, so it is rebuilt.
 *
 * @param {{ url?: string, fp?: string, shell?: string } | undefined} prev
 * @param {{ url: string, fp: string, installed: () => Promise<boolean> }} now
 */
export async function canReuseInstall(prev, { url, fp, installed }) {
  if (!prev || prev.url !== url || prev.fp !== fp) return false
  if (typeof prev.shell !== "string" || !prev.shell) return false
  return installed()
}

/**
 * Build a new native app under a new shell id, and say which build may reconnect if it fails.
 *
 * The id is minted, baked into the config the sync writes, and named to the dev server BEFORE
 * `build` starts: from then on the app already on the device is the old build, and it waits for
 * this one instead of reconnecting.
 *
 * A build that throws produced no install, so the device still holds the build `prev` names.
 * Whether that one may reconnect is the question `canReuseInstall` already answers, minus the
 * device check: the same dev URL and the same native fingerprint as when it was built. Then it
 * goes back to being the expected build — otherwise a `b` press that fails on signing, gradle
 * or pods tells a perfectly current app "waiting for the new build" for the rest of the session.
 * After a real native change it stays stale, because it is.
 *
 * `current.fp` has to be taken before this is called: the sync inside `build` writes the new
 * mark into the native project, and a fingerprint taken after it never matches `prev.fp`.
 *
 * `build` covers the sync and the build that installs. What runs after an install landed (a
 * relaunch, a route back to the host) stays outside, because by then the new build IS on the
 * device.
 *
 * @param {ReturnType<typeof openShellRegistry>} shells
 * @param {string} platform
 * @param {{ prev?: { url?: string, fp?: string, shell?: string }, url: string, fp: string }} current
 * @param {(shell: string) => Promise<unknown>} build
 */
export async function buildNewShell(shells, platform, current, build) {
  const { prev, url, fp } = current
  const shell = newShellId(platform)
  stampShellId(platform, shell)
  shells.expect(platform, shell)
  try {
    await build(shell)
  } catch (err) {
    if (
      prev?.url === url &&
      prev.fp === fp &&
      typeof prev.shell === "string" &&
      prev.shell
    )
      shells.expect(platform, prev.shell)
    throw err
  }
  return shell
}

/**
 * Open this run's expected-shells file and return the path plus a setter and a remover.
 *
 * Every platform of the run starts as `null` — nothing decided — which is what makes an app that
 * was already on the device wait while the native projects are prepared, instead of reconnecting
 * the moment the dev server answers. A platform the run leaves out has no entry, and one it drops
 * becomes `false`: the dev server tells both apps this run is not serving them, rather than
 * leaving them on a screen that promises they will open. Written through a rename so the dev
 * server, reading on every request, never sees half a file.
 *
 * @param {string} appRoot
 * @param {string[]} platforms
 */
export function openShellRegistry(appRoot, platforms) {
  const file = path.join(appRoot, ADAPTV_DIR, SHELLS_FILE)
  const expected = Object.fromEntries(platforms.map((p) => [p, null]))
  const write = () => {
    mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(expected))
    renameSync(tmp, file)
  }
  write()
  return {
    file,
    /** @param {string} platform @param {string} id */
    expect(platform, id) {
      expected[platform] = id
      write()
    },
    /**
     * Mark every platform outside `ready` as dropped from this run.
     * @param {string[]} ready
     */
    serveOnly(ready) {
      for (const p of Object.keys(expected))
        if (!ready.includes(p)) expected[p] = false
      write()
    },
    remove() {
      rmSync(file, { force: true })
    },
  }
}
