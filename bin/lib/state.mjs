// Everything the CLI remembers between runs, in ONE file: `.adaptv/state.json`.
//
// It used to be two — `build-cache.json` (fingerprints) and `devices.json` (the remembered
// device pick) — and would have become three the next time something needed remembering.
// They are the same thing: per-app state adaptv keeps for itself, git-ignored with the rest
// of `.adaptv/`, disposable. So they live in one file, namespaced by section (`build`,
// `devices`), and anything new gets a section rather than a file.
//
// Every write is a read-modify-write of the WHOLE file, replacing only its own section: a
// device pick must not drop the fingerprints a long `dev` run is holding in memory, and a
// build write must not drop a device picked in between. Reads never throw — absent, corrupt
// or half-written state is simply "nothing remembered", which costs a rebuild or a picker
// prompt, never correctness.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { ADAPTV_DIR } from "./native.mjs"

const stateFile = (appRoot) => path.join(appRoot, ADAPTV_DIR, "state.json")

function readState(appRoot) {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(appRoot), "utf8"))
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

/** One section of the state file — `{}` when nothing is remembered for it. */
export function readSection(appRoot, section) {
  const value = readState(appRoot)[section]
  return value && typeof value === "object" ? value : {}
}

/** Replace one section, preserving every other. */
export function writeSection(appRoot, section, value) {
  mkdirSync(path.join(appRoot, ADAPTV_DIR), { recursive: true })
  writeFileSync(
    stateFile(appRoot),
    `${JSON.stringify({ ...readState(appRoot), [section]: value }, null, 2)}\n`,
  )
}

/**
 * The `build` section: `{ web, sync, run }` — the web-bundle fingerprint, what was already
 * synced per platform, and what is already installed per device. Named wrappers because the
 * pipeline touches it from half a dozen places and a bare string key there reads like noise.
 */
export const readBuildState = (appRoot) => readSection(appRoot, "build")
export const writeBuildState = (appRoot, build) =>
  writeSection(appRoot, "build", build)
