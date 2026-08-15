import { createSign, generateKeyPairSync } from "node:crypto"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SignableManifest } from "#adaptv/ota/manifest-signing"
import {
  canonicalManifest,
  verifyManifestSignature,
} from "#adaptv/ota/manifest-signing"

const pair = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
})

const base: SignableManifest = {
  buildTag: "aaaabbbbccccdddd",
  createdAt: 1_700_000_000_000,
  nativeFingerprint: "fp-1",
  sha256: "a".repeat(64),
  url: "https://app.example/.well-known/adaptv/ota/bundle-aaaabbbbccccdddd.zip",
}

const sign = (m: SignableManifest) => ({
  ...m,
  manifestSignature: createSign("sha256")
    .update(canonicalManifest(m))
    .sign(pair.privateKey, "base64"),
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("the bytes that get signed", () => {
  it("is a fixed field order, independent of how the object was built", () => {
    //The signer and the verifier are different processes on different machines,
    //possibly different releases of adaptv. If key order could reach these bytes,
    //a valid signature would read as invalid and the channel would stop working
    //with a message that points at the wrong thing.
    const reordered = {
      url: base.url,
      sha256: base.sha256,
      nativeFingerprint: base.nativeFingerprint,
      createdAt: base.createdAt,
      buildTag: base.buildTag,
    }
    expect(canonicalManifest(reordered)).toBe(canonicalManifest(base))
  })

  it("ignores fields nobody agreed to sign", () => {
    //A future manifest field must not silently invalidate every deployed app's
    //copy of this function.
    expect(
      canonicalManifest({
        ...base,
        signature: "zip-sig",
      } as SignableManifest),
    ).toBe(canonicalManifest(base))
  })

  it("moves when any signed field moves", () => {
    for (const field of [
      "buildTag",
      "createdAt",
      "nativeFingerprint",
      "sha256",
      "url",
    ] as const) {
      const changed = {
        ...base,
        [field]: field === "createdAt" ? base.createdAt + 1 : "different",
      }
      expect(canonicalManifest(changed)).not.toBe(canonicalManifest(base))
    }
  })
})

describe("verifying a manifest's own signature", () => {
  it("accepts one produced by the matching private key", async () => {
    expect(
      await verifyManifestSignature({
        manifest: sign(base),
        publicKey: pair.publicKey,
      }),
    ).toBe(true)
  })

  it("refuses a replayed older bundle wearing a fresh timestamp", async () => {
    //The attack this exists for. The zip is genuine and its native signature
    //verifies perfectly; only `createdAt` was rewritten, and only this check sees
    //it. → `LIFECYCLE.md §5.4d`
    const signed = sign(base)
    expect(
      await verifyManifestSignature({
        manifest: { ...signed, createdAt: Date.now() },
        publicKey: pair.publicKey,
      }),
    ).toBe(false)
  })

  it("refuses a signature made by a different key", async () => {
    const other = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    })
    expect(
      await verifyManifestSignature({
        manifest: sign(base),
        publicKey: other.publicKey,
      }),
    ).toBe(false)
  })

  it("refuses a manifest carrying no signature at all", async () => {
    expect(
      await verifyManifestSignature({
        manifest: base,
        publicKey: pair.publicKey,
      }),
    ).toBe(false)
  })

  it("closes the gate on every kind of malformed input", async () => {
    //Every failure here means "do not install". There is no input — a broken key,
    //a signature that is not base64, an empty string — that can make this open.
    const signed = sign(base)
    const cases = [
      { manifest: signed, publicKey: "" },
      {
        manifest: signed,
        publicKey: "-----BEGIN PUBLIC KEY-----\nnope\n",
      },
      {
        manifest: { ...signed, manifestSignature: "!!!not base64!!!" },
        publicKey: pair.publicKey,
      },
      {
        manifest: { ...signed, manifestSignature: "" },
        publicKey: pair.publicKey,
      },
    ]
    for (const c of cases) {
      expect(await verifyManifestSignature(c)).toBe(false)
    }
  })

  it("refuses rather than passes when WebCrypto is missing", async () => {
    //An older Android System WebView, or any runtime without subtle crypto. The
    //safe direction is not installing; treating "cannot check" as "checked" would
    //hand the whole defence to whoever picks the device.
    vi.stubGlobal("crypto", {})
    expect(
      await verifyManifestSignature({
        manifest: sign(base),
        publicKey: pair.publicKey,
      }),
    ).toBe(false)
  })
})
