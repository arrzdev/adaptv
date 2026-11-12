// Binding parity check for website/wrangler.toml (the `gate` and the website workflow's
// `verify` job).
//
// Wrangler does not inherit bindings or vars into a named env: a binding added to the dev
// top level only is `undefined` in production, and the deploy succeeds anyway. This reads
// the config with wrangler's own parser, once for the top level and once per [env.*], and
// fails when:
//
//   - an env lacks a binding or a `vars` key that the top level has, or has one the top
//     level lacks (every kind wrangler binds: D1, KV, R2, DO, services, queues, rate
//     limits, AI, analytics engine, ...);
//   - an env has no explicit `name`, or reuses the dev name;
//   - [env.production] is missing, or its `name` is not the live Worker (a rename deploys
//     a second Worker and leaves the live one serving);
//   - an env this repo deploys has a placeholder id;
//   - two blocks share a D1 id, KV id, R2 bucket or rate-limit namespace_id;
//   - a named env binds a service to a `-dev` Worker.
//
// The playground is not deployed by CI and is left out. The site has no bindings today, so
// in practice this guards the names; the rest holds the line the day one is added.
//
// Wrangler is not a dependency of `website/` (its lockfile and build scripts stay as they
// are): the check installs the version the deploy step pins in website.yml into a temp
// directory and reuses it, so the parser is the one that deploys.
//
// Usage: node scripts/check-wrangler-envs.mjs   (or pnpm check:wrangler-envs)
// Tests: scripts/check-wrangler-envs.test.mjs, in the root vitest run

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const ROOT = resolve(import.meta.dirname, "..")

// The Workers this repo deploys. `liveName` is the live production Worker, which
// `.github/workflows/website.yml` deploys with `--env production`. Changing it is a
// Worker rename and needs its own PR. `deployed` lists the envs that are live today,
// where a placeholder id is an error.
const APPS = [
  {
    app: "website",
    config: "website/wrangler.toml",
    liveName: "adaptv-website",
    deployed: ["production"],
  },
]

// Binding kinds, each with the field that names the binding in the Worker.
// `durable_objects` and `queues` nest their lists one level down.
const LISTS = {
  d1_databases: "binding",
  kv_namespaces: "binding",
  r2_buckets: "binding",
  services: "binding",
  ratelimits: "name",
  analytics_engine_datasets: "binding",
  vectorize: "binding",
  hyperdrive: "binding",
  workflows: "binding",
  dispatch_namespaces: "binding",
  mtls_certificates: "binding",
  send_email: "name",
  secrets_store_secrets: "binding",
}
const SINGLES = ["ai", "browser", "images", "version_metadata", "assets"]

// Ids that must not be shared between two blocks, and their field.
const IDS = {
  d1_databases: "database_id",
  kv_namespaces: "id",
  r2_buckets: "bucket_name",
  ratelimits: "namespace_id",
}

const PLACEHOLDER =
  /^(0+(-0+)*|REPLACE_WITH.*|<.*>|TODO.*|placeholder.*)$/i

/** Every binding of a resolved config, as "kind NAME" strings. */
export function bindingsOf(config) {
  const out = new Set()
  for (const [kind, field] of Object.entries(LISTS)) {
    for (const b of config[kind] ?? []) out.add(`${kind} ${b[field]}`)
  }
  for (const b of config.durable_objects?.bindings ?? []) {
    out.add(`durable_objects ${b.name}`)
  }
  for (const b of config.queues?.producers ?? []) {
    out.add(`queues.producers ${b.binding}`)
  }
  for (const kind of SINGLES) {
    if (config[kind]?.binding) out.add(`${kind} ${config[kind].binding}`)
  }
  for (const key of Object.keys(config.vars ?? {})) out.add(`vars ${key}`)
  return out
}

/**
 * Checks one app's wrangler config. Returns a list of error strings.
 *   wrangler   the wrangler module (unstable_readConfig, experimental_readRawConfig)
 *   deployed   envs this repo deploys today
 *   liveName   the live production Worker name, or undefined if not recorded
 */
export function checkApp({
  app,
  configPath,
  wrangler,
  deployed,
  liveName,
}) {
  const errors = []
  const fail = (scope, msg) => errors.push(`${app} ${scope}: ${msg}`)

  const raw = wrangler.experimental_readRawConfig({
    config: configPath,
  }).rawConfig
  const envs = Object.keys(raw.env ?? {})
  const top = wrangler.unstable_readConfig({ config: configPath })
  const scopes = [["top level", top]]
  for (const env of envs) {
    scopes.push([
      `[env.${env}]`,
      wrangler.unstable_readConfig({ config: configPath, env }),
    ])
  }

  if (!envs.includes("production")) {
    fail(
      "[env.production]",
      "missing; the top level is dev, so production must be a named env",
    )
  }
  for (const env of deployed) {
    if (!envs.includes(env))
      fail(
        `[env.${env}]`,
        "listed as deployed in scripts/check-wrangler-envs.mjs but not declared",
      )
  }

  const topBindings = bindingsOf(top)
  for (const env of envs) {
    const scope = `[env.${env}]`
    const config = scopes.find(([s]) => s === scope)[1]

    // `name` from the raw file: the resolved config fills a missing one in
    // as `<top>-<env>`, which hides the omission.
    const name = raw.env[env].name
    if (typeof name !== "string" || name === "") {
      fail(
        scope,
        `no explicit name (wrangler would deploy "${raw.name}-${env}")`,
      )
    } else if (name === raw.name) {
      fail(scope, `name "${name}" is the dev name`)
    }
    if (env === "production" && name !== undefined) {
      if (liveName === undefined) {
        fail(
          scope,
          `no live Worker name recorded for ${app} in scripts/check-wrangler-envs.mjs`,
        )
      } else if (name !== liveName) {
        fail(
          scope,
          `name "${name}" is not the live Worker "${liveName}" (scripts/check-wrangler-envs.mjs); a rename deploys a second Worker`,
        )
      }
    }

    const envBindings = bindingsOf(config)
    for (const b of topBindings) {
      if (!envBindings.has(b))
        fail(scope, `missing ${b} (declared at the top level)`)
    }
    for (const b of envBindings) {
      if (!topBindings.has(b))
        fail(scope, `has ${b}, which the top level lacks`)
    }

    for (const s of config.services ?? []) {
      if (/-dev$/.test(s.service))
        fail(
          scope,
          `service binding ${s.binding} points at the dev Worker "${s.service}"`,
        )
    }

    if (deployed.includes(env)) {
      for (const [kind, field] of Object.entries(IDS)) {
        for (const b of config[kind] ?? []) {
          if (PLACEHOLDER.test(String(b[field] ?? ""))) {
            fail(
              scope,
              `${kind} ${b.binding ?? b.name} has placeholder ${field} "${b[field]}"`,
            )
          }
        }
      }
    }
  }

  // Shared ids across blocks (placeholders excluded: the rule above owns them).
  for (const [kind, field] of Object.entries(IDS)) {
    const seen = new Map()
    for (const [scope, config] of scopes) {
      for (const b of config[kind] ?? []) {
        const id = String(b[field] ?? "")
        if (id === "" || PLACEHOLDER.test(id)) continue
        const other = seen.get(id)
        if (other && other !== scope)
          fail(scope, `${kind} ${field} "${id}" is also used by ${other}`)
        else seen.set(id, scope)
      }
    }
  }

  return { errors, envs, bindings: topBindings.size }
}

/** The wrangler version the deploy step pins in website.yml. */
export function deployedWranglerVersion(
  workflow = readFileSync(
    join(ROOT, ".github/workflows/website.yml"),
    "utf8",
  ),
) {
  const m = workflow.match(/wrangler@(\d+\.\d+\.\d+) deploy/)
  if (!m) throw new Error("no `wrangler@x.y.z deploy` pin in website.yml")
  return m[1]
}

/** Wrangler at the deployed version, installed once into the temp dir. */
export function loadWrangler(version = deployedWranglerVersion()) {
  const prefix = join(tmpdir(), `adaptv-wrangler-${version}`)
  if (!existsSync(join(prefix, "node_modules/wrangler/package.json"))) {
    // No scripts: reading a config needs no workerd binary.
    const r = spawnSync(
      "npm",
      [
        "install",
        "--prefix",
        prefix,
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--no-package-lock",
        `wrangler@${version}`,
      ],
      { stdio: ["ignore", "ignore", "inherit"] },
    )
    if (r.status !== 0)
      throw new Error(`npm install wrangler@${version} failed`)
  }
  return createRequire(join(prefix, "x.js"))("wrangler")
}

function main() {
  // Wrangler's own warnings repeat what this check reports, less precisely.
  process.env.WRANGLER_LOG ??= "error"
  const wrangler = loadWrangler()

  let failed = 0
  for (const { app, config, liveName, deployed } of APPS) {
    const { errors, envs, bindings } = checkApp({
      app,
      configPath: join(ROOT, config),
      wrangler,
      deployed,
      liveName,
    })
    if (errors.length) {
      failed += errors.length
      for (const e of errors) console.error(`::error::${e}`)
    } else {
      console.log(
        `ok ${app}: top level + ${envs.join(", ")} match (${bindings} bindings and vars)`,
      )
    }
  }
  if (failed) {
    console.error(
      `wrangler-envs: ${failed} problem(s). Bindings and vars are not inherited: repeat each one in every [env.*].`,
    )
    process.exit(1)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
