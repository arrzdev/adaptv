// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { AdaptvBuildStamp } from "#adaptv/vite/build-stamp.ts"
import {
  buildStampPath,
  bundleIsStale,
  fileHash,
  readBuildStamp,
} from "#adaptv/vite/build-stamp.ts"

/**
 * The invalidation this file exists for, stated as a test:
 *
 * a `themeColor` edit re-derives the native project's splash colours (they are gated on
 * `appConfigFingerprint`) but used to leave the web bundle `cap sync` copies into the same
 * project untouched — one app, two colours. The stamp is what makes the bundle answer to
 * the same signal, so every case below is a way that answer can go wrong.
 */

const OUT = ".adaptv/web"

function app(): string {
  const root = mkdtempSync(path.join(tmpdir(), "adaptv-stamp-"))
  mkdirSync(path.join(root, OUT), { recursive: true })
  return root
}

/** Write a shell and a stamp that describes it — a healthy build, for `configId`. */
function build(root: string, configId: string, html = "<html>"): void {
  const shell = path.join(root, OUT, "index.html")
  writeFileSync(shell, html)
  stamp(root, {
    target: "capacitor",
    render: "spa",
    outDir: OUT,
    shell: "index.html",
    shellHash: fileHash(shell),
    configId,
  })
}

function stamp(root: string, value: Partial<AdaptvBuildStamp>): void {
  const file = buildStampPath(root, "capacitor")
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value))
}

describe("bundleIsStale — may this bundle be synced into the native project?", () => {
  it("accepts the bundle the current config produced", () => {
    const root = app()
    build(root, "cfg-1")
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  it("rejects a bundle built before the config was edited", () => {
    //THE bug. `dev ios` skipped the build whenever a bundle existed at all, so the
    //shell inside the `.ipa` kept the colour the dev had already replaced while the
    //native splash beside it was regenerated with the new one.
    const root = app()
    build(root, "cfg-before")
    expect(bundleIsStale(root, "capacitor", "cfg-after")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("rejects a shell whose bytes moved after the build that stamped it", () => {
    //The OUTPUTS half. A cache key alone cannot see a hand-edited, half-written or
    //externally-replaced bundle; asking whether the document on disk is still the one
    //this build wrote can. Same shape as `generateAssets`.
    const root = app()
    build(root, "cfg-1")
    writeFileSync(path.join(root, OUT, "index.html"), "<html>edited")
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("rejects a bundle whose shell is gone", () => {
    const root = app()
    build(root, "cfg-1")
    rmSync(path.join(root, OUT, "index.html"))
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("rejects a build the CLI did not run", () => {
    //A bare `vite build` stamps no id, because the id has exactly one producer. An
    //unknown provenance is not a pass — it is the reason to rebuild.
    const root = app()
    build(root, "cfg-1")
    const shell = path.join(root, OUT, "index.html")
    stamp(root, {
      target: "capacitor",
      render: "spa",
      outDir: OUT,
      shell: "index.html",
      shellHash: fileHash(shell),
      configId: null,
    })
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("rejects a bundle with no stamp at all", () => {
    const root = app()
    writeFileSync(path.join(root, OUT, "index.html"), "<html>")
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("survives a corrupt stamp without throwing", () => {
    //A build killed mid-write leaves half a JSON document. It must read as stale, not
    //as a crashed command.
    const root = app()
    const file = buildStampPath(root, "capacitor")
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, "{ not json")
    expect(readBuildStamp(root, "capacitor")).toBeNull()
    expect(bundleIsStale(root, "capacitor", "cfg-1")).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  it("keeps the two lineages apart", () => {
    //`preview all` builds both from one command. One file for both would leave
    //whichever ran last describing the other's directory.
    const root = app()
    build(root, "cfg-1")
    expect(buildStampPath(root, "web")).not.toBe(
      buildStampPath(root, "capacitor"),
    )
    expect(readBuildStamp(root, "web")).toBeNull()
    rmSync(root, { recursive: true, force: true })
  })
})
