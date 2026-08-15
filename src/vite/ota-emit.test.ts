import { createHash, createVerify } from "node:crypto"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  canonicalManifest,
  verifyManifestSignature,
} from "#adaptv/ota/manifest-signing.ts"
import type { UpdateManifest } from "#adaptv/ota/policy.ts"
import {
  buildBundleArchive,
  computeBuildTag,
  decideChannelEmission,
  fetchDeployedManifest,
  generateOtaKeyPair,
  isUsableOtaPublicKey,
  resolveSigningKey,
  signingKeyMatches,
  writeChannel,
} from "#adaptv/vite/ota-emit.ts"

function clientDir(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "adaptv-ota-"))
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, body)
  }
  return dir
}

const APP = {
  "index.html": "<!doctype html><div id=app></div>",
  "assets/index-abc.js": "console.log(1)",
}

const manifest = (over: Partial<UpdateManifest> = {}): UpdateManifest => ({
  buildTag: "aaaabbbbccccdddd",
  url: "https://app.example/.well-known/adaptv/ota/bundle-aaaabbbbccccdddd.zip",
  sha256: "0".repeat(64),
  nativeFingerprint: "fp-1",
  createdAt: 1_700_000_000_000,
  ...over,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the bundle's identity", () => {
  it("is the same for the same bytes, and different for different ones", () => {
    expect(computeBuildTag(clientDir(APP))).toBe(
      computeBuildTag(clientDir(APP)),
    )
    expect(computeBuildTag(clientDir(APP))).not.toBe(
      computeBuildTag(
        clientDir({ ...APP, "assets/index-abc.js": "console.log(2)" }),
      ),
    )
  })

  it("changes when a file is renamed but its bytes are not", () => {
    //the browser fetches by name: same bytes at a new URL is a different app
    const before = computeBuildTag(clientDir(APP))
    const after = computeBuildTag(
      clientDir({
        "index.html": APP["index.html"],
        "assets/index-def.js": APP["assets/index-abc.js"],
      }),
    )
    expect(before).not.toBe(after)
  })

  it("cannot be confused by a space inside a filename", () => {
    //`"a b" + "c"` and `"a" + "b c"` are the same character stream — only a
    //separator no path can contain keeps these two builds apart
    const first = computeBuildTag(
      clientDir({ "index.html": "x", "a b": "c" }),
    )
    const second = computeBuildTag(
      clientDir({ "index.html": "x", a: "b c" }),
    )
    expect(first).not.toBe(second)
  })
})

describe("the archive", () => {
  it("refuses a directory with no entry document", () => {
    //a bundle with no index.html is one every device would fail to boot, and the
    //rollback that follows is a much more expensive way to learn this
    expect(() =>
      buildBundleArchive(clientDir({ "assets/orphan.js": "1" })),
    ).toThrow(/no index\.html/)
  })

  it("is byte-identical for two builds of the same output", () => {
    expect(
      buildBundleArchive(clientDir(APP)).equals(
        buildBundleArchive(clientDir(APP)),
      ),
    ).toBe(true)
  })
})

describe("what a deploy announces", () => {
  it("keeps the published timestamp when the build has not changed", () => {
    //a scheduled CI deploy of identical bytes must not read as a new release
    const deployed = manifest({ buildTag: "same-tag" })
    const plan = decideChannelEmission({
      buildTag: "same-tag",
      deployed,
      now: 1_800_000_000_000,
    })
    expect(plan.createdAt).toBe(deployed.createdAt)
    expect(plan.reused).toBe(true)
  })

  it("stamps a new one when the build did change", () => {
    const plan = decideChannelEmission({
      buildTag: "new-tag",
      deployed: manifest({ buildTag: "old-tag" }),
      now: 1_800_000_000_000,
    })
    expect(plan.createdAt).toBe(1_800_000_000_000)
    expect(plan.reused).toBe(false)
  })

  it("treats an unreadable channel as 'nothing is published'", () => {
    //a first deploy, a VPN-only origin, a DNS blip — all the same, and all safe
    const plan = decideChannelEmission({
      buildTag: "any",
      deployed: null,
      now: 42,
    })
    expect(plan).toEqual({ buildTag: "any", createdAt: 42, reused: false })
  })
})

describe("reading the deployed channel", () => {
  it("returns the manifest it is serving", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(manifest()))),
    )
    expect(
      await fetchDeployedManifest("https://app.example/m.json"),
    ).toEqual(manifest())
  })

  it("never throws, whatever the channel does", async () => {
    const cases = [
      async () => new Response("", { status: 404 }),
      async () => new Response("not json"),
      async () => new Response(JSON.stringify({ buildTag: 7 })),
      async () => {
        throw new Error("ENOTFOUND")
      },
    ]
    for (const impl of cases) {
      vi.stubGlobal("fetch", vi.fn(impl))
      expect(
        await fetchDeployedManifest("https://app.example/m.json"),
      ).toBeNull()
    }
  })
})

describe("writing the channel into the site", () => {
  it("puts a manifest and its bundle where an installed app looks", () => {
    const dir = clientDir(APP)
    const archive = buildBundleArchive(dir)
    const written = writeChannel({
      clientDir: dir,
      origin: "https://app.example",
      plan: { buildTag: "tag123", createdAt: 99, reused: false },
      archive,
      nativeFingerprint: "fp-7",
      privateKey: null,
    })

    expect(written.bundlePath).toBe(
      path.join(dir, ".well-known/adaptv/ota/bundle-tag123.zip"),
    )
    expect(readFileSync(written.bundlePath).equals(archive)).toBe(true)

    const published = JSON.parse(
      readFileSync(written.manifestPath, "utf8"),
    )
    expect(published).toEqual({
      buildTag: "tag123",
      url: "https://app.example/.well-known/adaptv/ota/bundle-tag123.zip",
      sha256: createHash("sha256").update(archive).digest("hex"),
      nativeFingerprint: "fp-7",
      createdAt: 99,
    })
  })

  it("omits the signature field rather than publishing an empty one", () => {
    //the runtime treats "no signature" as a refusal by default; an empty string
    //would be a present-but-worthless one
    const dir = clientDir(APP)
    const written = writeChannel({
      clientDir: dir,
      origin: "https://app.example",
      plan: { buildTag: "t", createdAt: 1, reused: false },
      archive: buildBundleArchive(dir),
      nativeFingerprint: "fp",
      privateKey: null,
    })
    const published = JSON.parse(
      readFileSync(written.manifestPath, "utf8"),
    )
    expect("signature" in published).toBe(false)
    expect("manifestSignature" in published).toBe(false)
  })
})

describe("signing what gets published", () => {
  const pair = generateOtaKeyPair()

  /** A signed channel, and the manifest it published. */
  function publish(over: { archive?: Buffer } = {}) {
    const dir = clientDir(APP)
    const archive = over.archive ?? buildBundleArchive(dir)
    const written = writeChannel({
      clientDir: dir,
      origin: "https://app.example",
      plan: { buildTag: "signed1", createdAt: 1234, reused: false },
      archive,
      nativeFingerprint: "fp-9",
      privateKey: pair.privateKey,
    })
    return {
      archive,
      manifest: JSON.parse(
        readFileSync(written.manifestPath, "utf8"),
      ) as UpdateManifest,
    }
  }

  it("signs the zip the way the native check reads it", () => {
    //RSASSA-PKCS1-v1_5 over SHA-256 of the ARCHIVE — the same thing Android's
    //`SHA256withRSA` and iOS's `rsaSignatureDigestPKCS1v15SHA256` verify. Neither
    //runs here, so this asserts the shape they were measured to accept.
    const { archive, manifest: m } = publish()
    expect(
      createVerify("sha256")
        .update(archive)
        .verify(pair.publicKey, m.signature as string, "base64"),
    ).toBe(true)
  })

  it("signs the fields the native check cannot see", async () => {
    //The signed downgrade: a genuine older zip under a fresh timestamp verifies
    //natively and walks the device backwards. This is the signature that stops it.
    const { manifest: m } = publish()
    expect(
      await verifyManifestSignature({
        manifest: m,
        publicKey: pair.publicKey,
      }),
    ).toBe(true)
  })

  it("produces a manifest signature the runtime rejects once edited", async () => {
    const { manifest: m } = publish()
    for (const tampered of [
      { ...m, createdAt: m.createdAt + 1 },
      { ...m, url: "https://evil.example/bundle.zip" },
      { ...m, buildTag: "otherone" },
      { ...m, nativeFingerprint: "fp-other" },
      { ...m, sha256: "f".repeat(64) },
    ]) {
      expect(
        await verifyManifestSignature({
          manifest: tampered,
          publicKey: pair.publicKey,
        }),
      ).toBe(false)
    }
  })

  it("signs exactly the canonical form, not the JSON", () => {
    //The signer and the verifier are different processes on different machines.
    //Anything that lets key order or formatting into the signed bytes turns a
    //valid signature invalid — a channel that stops working for no visible reason.
    const { manifest: m } = publish()
    expect(
      createVerify("sha256")
        .update(canonicalManifest(m))
        .verify(pair.publicKey, m.manifestSignature as string, "base64"),
    ).toBe(true)
  })

  it("catches a key pair whose halves are not each other's", () => {
    //Both halves valid, the build green, and every installed app rejecting the
    //update. Nothing downstream of the build can report this.
    const other = generateOtaKeyPair()
    expect(signingKeyMatches(pair.publicKey, pair.privateKey)).toBe(true)
    expect(signingKeyMatches(pair.publicKey, other.privateKey)).toBe(false)
    expect(signingKeyMatches("not a key", pair.privateKey)).toBe(false)
  })

  it("recognises the public keys a device can actually load", () => {
    expect(isUsableOtaPublicKey(pair.publicKey)).toBe(true)
    //an SPKI PEM, not a private one and not a fragment of the block
    expect(isUsableOtaPublicKey(pair.privateKey.slice(0, 200))).toBe(false)
    expect(isUsableOtaPublicKey("")).toBe(false)
  })
})

describe("finding the key to sign with", () => {
  const clear = () => {
    process.env.ADAPTV_OTA_PRIVATE_KEY = undefined
    process.env.ADAPTV_OTA_PRIVATE_KEY_FILE = undefined
    delete process.env.ADAPTV_OTA_PRIVATE_KEY
    delete process.env.ADAPTV_OTA_PRIVATE_KEY_FILE
  }
  afterEach(clear)

  it("takes the PEM straight from the environment", () => {
    const { privateKey } = generateOtaKeyPair()
    process.env.ADAPTV_OTA_PRIVATE_KEY = privateKey
    expect(resolveSigningKey()).toBe(privateKey)
  })

  it("reads it from a file, for a laptop that keeps it out of the repo", () => {
    const { privateKey } = generateOtaKeyPair()
    const file = path.join(
      mkdtempSync(path.join(tmpdir(), "adaptv-key-")),
      "ota.pem",
    )
    writeFileSync(file, privateKey)
    process.env.ADAPTV_OTA_PRIVATE_KEY_FILE = file
    expect(resolveSigningKey()).toBe(privateKey)
  })

  it("is null when there is no key at all", () => {
    clear()
    expect(resolveSigningKey()).toBeNull()
  })

  it("refuses a named file it cannot read, rather than publishing unsigned", () => {
    //"the variable was set and nothing happened" is the failure mode worth
    //spending an exception on: silence here ships an unsigned channel.
    process.env.ADAPTV_OTA_PRIVATE_KEY_FILE = "/nope/ota.pem"
    expect(() => resolveSigningKey()).toThrow(/cannot be read/)
  })

  it("ignores a variable holding something that is not a key", () => {
    //CI hands you an empty string when a secret is missing from the environment
    process.env.ADAPTV_OTA_PRIVATE_KEY = ""
    expect(resolveSigningKey()).toBeNull()
  })
})
