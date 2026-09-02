import type { UpdateManifest } from "#adaptv/ota/policy"

/**
 * The signed form of a manifest, and the check that reads it. → `docs/design/ota.md §5.4d`
 *
 * ## Two signatures, because they defend different things
 *
 * The update plugin verifies **natively** an RSA signature over the SHA-256 of the
 * zip (`manifest.signature`). That is the one that matters: it is what stops
 * anyone who can write to the CDN from running arbitrary JavaScript inside every
 * installed app, and it is checked by code an attacker is not in a position to
 * replace.
 *
 * It does not, however, cover the manifest. Every field around the zip —
 * `createdAt`, `nativeFingerprint`, `url`, the tag — travels unsigned, and that
 * leaves a **signed downgrade**: point a fresh-looking manifest at a genuine
 * *older* bundle, and its zip signature verifies perfectly while the device walks
 * backwards to a version whose bugs are known. `manifest.manifestSignature`
 * closes that, over the canonical form below.
 *
 * ## Why verifying it in JavaScript is still worth doing
 *
 * A check running in the bundle is worthless against an attacker who can replace
 * the bundle — but that is precisely what the *native* signature prevents. So the
 * two compose: native verification keeps attacker code out of the app, and this
 * check keeps a CDN compromise from rearranging honest bundles. Neither is
 * forgeable without the private key, and the public key is baked into the store
 * binary, where it can only change through a store release.
 */

/**
 * The fields covered by `manifestSignature`, in the order they are serialised.
 *
 * `url` is in it deliberately. `sha256` already binds the *content*, so a swapped
 * URL cannot change what runs — but it can point every device on the channel at
 * an endpoint of the attacker's choosing, which is a way to have them all report
 * in. Signing it costs nothing.
 */
const SIGNED_FIELDS = [
  "buildTag",
  "createdAt",
  "nativeFingerprint",
  "sha256",
  "url",
] as const

export type SignableManifest = Pick<
  UpdateManifest,
  (typeof SIGNED_FIELDS)[number]
>

/**
 * The exact bytes that get signed.
 *
 * Spelled out field by field rather than `JSON.stringify(manifest)`, because the
 * signer and the verifier are in different processes, on different machines, and
 * possibly different releases of adaptv. Anything that lets a key's order, an
 * added field or a formatting change alter this string turns a valid signature
 * into an invalid one — an update channel that silently stops working, with a
 * "signature verification failed" that points at the wrong thing.
 */
export function canonicalManifest(manifest: SignableManifest): string {
  return SIGNED_FIELDS.map((field) => `${field}=${manifest[field]}`).join(
    "\n",
  )
}

/** Decode a PEM public key to the SPKI bytes WebCrypto wants. */
function pemToSpki(pem: string): Uint8Array {
  const base64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "")
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const ALGORITHM = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const

/**
 * Verify a manifest's own signature.
 *
 * Returns `false` for every failure — a bad signature, a malformed key, a missing
 * field, no WebCrypto at all. The caller treats false as "do not install", so
 * there is no failure mode here that opens the gate; the worst one closes it.
 */
export async function verifyManifestSignature(options: {
  manifest: SignableManifest & { manifestSignature?: string }
  /** SPKI PEM, baked into the store binary. */
  publicKey: string
}): Promise<boolean> {
  const { manifest, publicKey } = options
  if (!manifest.manifestSignature) return false
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return false
    const key = await subtle.importKey(
      "spki",
      pemToSpki(publicKey) as unknown as ArrayBuffer,
      ALGORITHM,
      false,
      ["verify"],
    )
    return await subtle.verify(
      ALGORITHM.name,
      key,
      base64ToBytes(manifest.manifestSignature) as unknown as ArrayBuffer,
      new TextEncoder().encode(canonicalManifest(manifest)),
    )
  } catch {
    return false
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
