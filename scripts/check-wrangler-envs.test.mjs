// Tests for check-wrangler-envs.mjs. Every case starts from the real
// website/wrangler.toml and breaks one thing, so they prove the check against the file
// that deploys. The wrangler under test is the deployed one (installed once into the temp
// dir by the first run, so that run is slower).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import {
  checkApp,
  deployedWranglerVersion,
  loadWrangler,
} from "./check-wrangler-envs.mjs"

const root = resolve(import.meta.dirname, "..")
const real = readFileSync(join(root, "website/wrangler.toml"), "utf8")
// The top level, and the [env.production] block that follows it.
const [top, prod] = real.split("[env.production]\n")

const D1_A = "11111111-aaaa-4aaa-8aaa-111111111111"
const D1_B = "22222222-bbbb-4bbb-8bbb-222222222222"
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000"
const d1 = (scope, id) =>
  `[[${scope}d1_databases]]\nbinding = "DB"\ndatabase_name = "db"\ndatabase_id = "${id}"\n`

let wrangler
let dir
let n = 0
beforeAll(() => {
  process.env.WRANGLER_LOG ??= "error"
  wrangler = loadWrangler()
  dir = mkdtempSync(join(tmpdir(), "wrangler-envs-"))
}, 180_000)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function check(toml, opts = {}) {
  const configPath = join(dir, `wrangler-${n++}.toml`)
  writeFileSync(configPath, toml)
  return checkApp({
    app: "website",
    configPath,
    wrangler,
    deployed: opts.deployed ?? ["production"],
    liveName: "liveName" in opts ? opts.liveName : "adaptv-website",
  }).errors
}

describe("check-wrangler-envs", () => {
  test("the website config passes", () => {
    expect(check(real)).toEqual([])
  })

  test("the deploy step pins the wrangler the check installs", () => {
    expect(deployedWranglerVersion()).toMatch(/^\d+\.\d+\.\d+$/)
  })

  test("a binding at the top level only fails", () => {
    const toml = `${top}${d1("", D1_A)}\n[env.production]\n${prod}`
    expect(check(toml)).toEqual([
      "website [env.production]: missing d1_databases DB (declared at the top level)",
    ])
  })

  test("a vars key missing from production fails", () => {
    const toml = `${top}[vars]\nDEPLOY_ENV = "local"\n\n[env.production]\n${prod}`
    expect(check(toml)).toEqual([
      "website [env.production]: missing vars DEPLOY_ENV (declared at the top level)",
    ])
  })

  test("a binding in production but not at the top level fails", () => {
    const toml = `${real}\n${d1("env.production.", D1_A)}`
    expect(check(toml)).toEqual([
      "website [env.production]: has d1_databases DB, which the top level lacks",
    ])
  })

  test("a binding repeated in both blocks passes", () => {
    const toml = `${top}${d1("", PLACEHOLDER)}\n[env.production]\n${prod}\n${d1("env.production.", D1_A)}`
    expect(check(toml)).toEqual([])
  })

  test("production without an explicit name fails", () => {
    const toml = real.replace('name = "adaptv-website"\n', "")
    expect(check(toml)).toEqual([
      'website [env.production]: no explicit name (wrangler would deploy "adaptv-website-dev-production")',
    ])
  })

  test("production that reuses the dev name fails", () => {
    const toml = real.replace(
      'name = "adaptv-website"',
      'name = "adaptv-website-dev"',
    )
    const errors = check(toml)
    expect(errors).toContain(
      'website [env.production]: name "adaptv-website-dev" is the dev name',
    )
  })

  test("a production name that is not the live Worker fails", () => {
    const errors = check(real, { liveName: "adaptv-site" })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(
      /name "adaptv-website" is not the live Worker "adaptv-site"/,
    )
  })

  test("a config without [env.production] fails", () => {
    expect(check(top, { deployed: [] })).toEqual([
      "website [env.production]: missing; the top level is dev, so production must be a named env",
    ])
  })

  test("a placeholder id in a deployed env fails", () => {
    const toml = `${top}${d1("", PLACEHOLDER)}\n[env.production]\n${prod}\n${d1("env.production.", PLACEHOLDER)}`
    expect(check(toml)).toEqual([
      `website [env.production]: d1_databases DB has placeholder database_id "${PLACEHOLDER}"`,
    ])
    // Not deployed yet: placeholders are fine.
    expect(check(toml, { deployed: [] })).toEqual([])
  })

  test("a D1 id shared by the top level and production fails", () => {
    const toml = `${top}${d1("", D1_A)}\n[env.production]\n${prod}\n${d1("env.production.", D1_A)}`
    expect(check(toml)).toEqual([
      `website [env.production]: d1_databases database_id "${D1_A}" is also used by top level`,
    ])
    const own = toml.replace(`${D1_A}"\n\n`, `${D1_B}"\n\n`)
    expect(check(own)).toEqual([])
  })

  test("a service binding to a -dev Worker fails", () => {
    const svc = (scope, service) =>
      `[[${scope}services]]\nbinding = "API"\nservice = "${service}"\n`
    const toml = `${top}${svc("", "api")}\n[env.production]\n${prod}\n${svc("env.production.", "api-dev")}`
    expect(check(toml)).toEqual([
      'website [env.production]: service binding API points at the dev Worker "api-dev"',
    ])
  })
})
