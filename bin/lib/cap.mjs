#!/usr/bin/env node
// adaptv's Capacitor CLI entrypoint — the ONLY way adaptv invokes `cap`.
//
// It exists to guarantee one thing: Capacitor reads its config from the in-memory
// `ADAPTV_CAPACITOR_CONFIG` env var, so the consumer's project carries NO
// `capacitor.config.json`. adaptv patches `@capacitor/cli` (patches/@capacitor__cli@…patch)
// to read that env — but pnpm applies a patch only from the ROOT project's manifest, so a
// PUBLISHED consumer's copy of Capacitor is NOT patched (→ docs/decisions/register.md L20). This shim is
// the VENDORED half: it ships inside adaptv and re-creates the patch's effect in-process
// when the installed CLI isn't patched, so the behaviour travels with the framework.
//
// adaptv spawns this as a child process per cap command (`node cap.mjs <args…>`), so
// Commander's global program is fresh each time — no cross-command state.
import { readFileSync } from "node:fs"
import { createRequire, Module } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const cliPkg = require.resolve("@capacitor/cli/package.json") // resolved from adaptv
const cliDir = path.dirname(cliPkg)

// Capacitor resolves the PLATFORM packages (@capacitor/ios, @capacitor/android) and every
// plugin from the CONSUMER's app root — `resolveNode(config.app.rootDir, name)` in its
// dist/util/node.js. But adaptv owns those packages (they're adaptv's deps; the app declares
// no @capacitor/* at all → docs/decisions/register.md L20), so from the app root they don't exist and cap
// dies with "Could not find the ios platform".
//
// It only appeared to work because pnpm's `node_modules/.bin/adaptv` shim happens to export a
// NODE_PATH covering adaptv's own node_modules — an accident of the launcher, absent when the
// CLI is invoked any other way (plain `node`, a global install, a different package manager).
// So make it explicit here: adaptv's node_modules goes on NODE_PATH before cap loads.
// `require.resolve(..., { paths })` still consults NODE_PATH (it's a GLOBAL_FOLDER, always
// searched), so cap's app-root-anchored lookup falls through to adaptv's copy and resolves.
// this file is <adaptv>/bin/lib/cap.mjs → up three for the package root
const adaptvModules = path.join(
  path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))),
  "node_modules",
)
const nodePath = process.env.NODE_PATH
if (!nodePath?.split(path.delimiter).includes(adaptvModules)) {
  process.env.NODE_PATH = nodePath
    ? `${nodePath}${path.delimiter}${adaptvModules}`
    : adaptvModules
  Module._initPaths() //re-read NODE_PATH into the resolver's global folders
}

const envConfig = process.env.ADAPTV_CAPACITOR_CONFIG
const alreadyPatched =
  !!envConfig &&
  /ADAPTV_CAPACITOR_CONFIG/.test(
    readFileSync(path.join(cliDir, "dist", "config.js"), "utf8"),
  )

// Unpatched install (e.g. published) but adaptv handed us a config: reproduce the patch in
// memory by intercepting the two fs reads Capacitor's `loadExtConfig` performs, so upstream
// still assembles the full config object — we only swap the SOURCE from a file to the env.
if (envConfig && !alreadyPatched) {
  const capRequire = createRequire(cliPkg)
  const fsExtra = capRequire("fs-extra") // same instance config.js captured
  const isCapConfig = (p) =>
    /capacitor\.config\.(ts|js|json)$/.test(String(p))
  const origPathExists = fsExtra.pathExists.bind(fsExtra)
  const origReadJSON = fsExtra.readJSON.bind(fsExtra)
  // Force the JSON branch: report the .ts/.js configs absent…
  fsExtra.pathExists = (p, ...rest) =>
    isCapConfig(p) && !String(p).endsWith(".json")
      ? Promise.resolve(false)
      : origPathExists(p, ...rest)
  // …and serve the env config as the .json read.
  fsExtra.readJSON = (p, ...rest) =>
    isCapConfig(p) && String(p).endsWith(".json")
      ? Promise.resolve(JSON.parse(envConfig))
      : origReadJSON(p, ...rest)
}

// Run the real CLI in-process. `run()` parses process.argv (node, cap.mjs, <cmd>, …) and
// dispatches — one command per process, so Commander's singleton is never reused.
require(path.join(cliDir, "dist", "index.js")).run()
