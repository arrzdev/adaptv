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
 * Open this run's expected-shells file and return the path plus a setter and a remover.
 *
 * Every platform of the run starts as `null` — nothing decided — which is what makes an app that
 * was already on the device wait while the native projects are prepared, instead of reconnecting
 * the moment the dev server answers. Written through a rename so the dev server, reading on every
 * request, never sees half a file.
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
    remove() {
      rmSync(file, { force: true })
    },
  }
}
