// The gate this file guards has two ways to fail and only one of them is loud.
//
// Under-including → a bundle calls a plugin the binary lacks → crash on a user's
// device, with no review and no staged rollout upstream to catch it.
//
// Over-including → the fingerprint moves when nothing callable moved → every
// update is refused, forever, and nobody files a bug because it looks like "OTA
// just doesn't work here". That is the one these tests are mostly about, because
// the tempting refactor — reuse `stamp-privacy`'s list wholesale, or reuse the
// CLI's same-named `nativeFingerprint()` — produces exactly it.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { computeNativeFingerprint } from "#adaptv/ota/native-fingerprint.ts"

let appRoot: string | null = null
afterEach(() => {
  if (appRoot) rmSync(appRoot, { recursive: true, force: true })
  appRoot = null
})

type Pkg = {
  /** Present + a platform dir ⇒ contributes native code. */
  native?: boolean
  version?: string
}

/** An app root with a real `node_modules` the resolver can walk. */
function scaffold(deps: Record<string, Pkg>): string {
  appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-fp-"))
  writeFileSync(
    path.join(appRoot, "package.json"),
    JSON.stringify({
      name: "scratch-app",
      dependencies: Object.fromEntries(
        Object.entries(deps).map(([n, p]) => [n, p.version ?? "1.0.0"]),
      ),
    }),
  )
  for (const [name, pkg] of Object.entries(deps)) {
    const dir = path.join(appRoot, "node_modules", ...name.split("/"))
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name,
        main: "index.js",
        version: pkg.version ?? "1.0.0",
        ...(pkg.native ? { capacitor: { ios: {}, android: {} } } : {}),
      }),
    )
    writeFileSync(path.join(dir, "index.js"), "")
    if (pkg.native) {
      mkdirSync(path.join(dir, "ios"), { recursive: true })
      mkdirSync(path.join(dir, "android"), { recursive: true })
    }
  }
  return appRoot
}

const fp = (root: string, appId = "com.acme.app") =>
  computeNativeFingerprint(root, { appId, adaptvRoot: root })

describe("what must NOT move the fingerprint", () => {
  it("survives a bump of a purely-JS dependency", () => {
    //`date-fns` has no native code. If this moves the hash, every JS dep bump
    //stops OTA dead — which is what reusing the privacy manifest's list would do.
    const before = fp(scaffold({ "date-fns": { version: "4.1.0" } }))
    rmSync(appRoot as string, { recursive: true, force: true })
    const after = fp(scaffold({ "date-fns": { version: "4.2.0" } }))

    expect(after.fingerprint).toBe(before.fingerprint)
    expect(after.plugins).toEqual([])
  })

  it("ignores a package with a platform dir but no native declaration", () => {
    //A folder called `ios/` proves nothing — screenshots live there too. The
    //`capacitor` field is what the native tooling actually keys on.
    const withDecoy = mkdtempSync(path.join(tmpdir(), "adaptv-fp-decoy-"))
    try {
      writeFileSync(
        path.join(withDecoy, "package.json"),
        JSON.stringify({ dependencies: { "some-lib": "1.0.0" } }),
      )
      const dir = path.join(withDecoy, "node_modules", "some-lib")
      mkdirSync(path.join(dir, "ios"), { recursive: true })
      writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "some-lib", version: "1.0.0" }),
      )
      expect(
        computeNativeFingerprint(withDecoy, {
          appId: "com.acme.app",
          adaptvRoot: withDecoy,
        }).plugins,
      ).toEqual([])
    } finally {
      rmSync(withDecoy, { recursive: true, force: true })
    }
  })

  it("does not depend on where the app happens to live on disk", () => {
    //Two machines building the same commit must agree, or the gate refuses
    //updates it should accept — a failure that only shows up in CI-vs-laptop.
    const a = fp(scaffold({ "@capacitor/camera": { native: true } }))
    rmSync(appRoot as string, { recursive: true, force: true })
    const b = fp(scaffold({ "@capacitor/camera": { native: true } }))

    expect(b.fingerprint).toBe(a.fingerprint)
  })
})

describe("what MUST move it", () => {
  it("changes when a native plugin is added", () => {
    const before = fp(scaffold({ "date-fns": {} }))
    rmSync(appRoot as string, { recursive: true, force: true })
    const after = fp(
      scaffold({ "date-fns": {}, "@capacitor/camera": { native: true } }),
    )

    expect(after.fingerprint).not.toBe(before.fingerprint)
    expect(after.plugins).toEqual(["@capacitor/camera@1.0.0"])
  })

  it("changes when a native plugin's version changes", () => {
    //A plugin minor can add a native method the JS then calls. Version is part
    //of the callable surface, not metadata.
    const before = fp(
      scaffold({
        "@capacitor/camera": { native: true, version: "8.0.0" },
      }),
    )
    rmSync(appRoot as string, { recursive: true, force: true })
    const after = fp(
      scaffold({
        "@capacitor/camera": { native: true, version: "8.1.0" },
      }),
    )

    expect(after.fingerprint).not.toBe(before.fingerprint)
  })

  it("changes with the appId", () => {
    //A bundle built for one application identity booting inside another is a
    //mis-wired channel, not an update.
    const root = scaffold({ "@capacitor/camera": { native: true } })
    expect(fp(root, "com.acme.app").fingerprint).not.toBe(
      fp(root, "com.other.app").fingerprint,
    )
  })
})

describe("the result is legible, because a refused update has to be explainable", () => {
  it("reports the exact plugin set that produced the hash, sorted", () => {
    const root = scaffold({
      "@capacitor/keyboard": { native: true, version: "8.0.1" },
      "@capacitor/camera": { native: true, version: "8.0.0" },
      lodash: { version: "4.17.21" },
    })
    const result = fp(root)

    expect(result.plugins).toEqual([
      "@capacitor/camera@8.0.0",
      "@capacitor/keyboard@8.0.1",
    ])
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/)
  })
})
