import {
  createHash,
  createPublicKey,
  createSign,
  generateKeyPairSync,
} from "node:crypto"
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { canonicalManifest } from "#adaptv/ota/manifest-signing.ts"
import type { UpdateManifest } from "#adaptv/ota/policy.ts"
import { OTA_CHANNEL_PATH } from "#adaptv/vite/ota-config-module.ts"
import type { ZipEntry } from "#adaptv/vite/ota-zip.ts"
import { createZip } from "#adaptv/vite/ota-zip.ts"

/**
 * Publishing the update channel — the deploy's own half of OTA. → `LIFECYCLE.md §5.2`
 *
 * ## The channel is part of the site, not a second pipeline
 *
 * Everything here lands inside `dist/client/.well-known/adaptv/ota/`, so the
 * ordinary web deploy that serves the PWA also serves every native install its
 * updates. There is no bucket to provision and nothing for CI to do beyond what
 * it already does with `dist/client`.
 *
 * 🔴 That also means the channel must be written on **every** deploy, including
 * one where nothing changed. A deploy replaces the whole site; omit the manifest
 * because "it is already up there" and the next deploy silently deletes the
 * channel, and every installed app starts 404ing on its update check.
 *
 * ## What "unchanged" is allowed to skip
 *
 * The `buildTag` is a content hash of the built client, so an unchanged app
 * produces an unchanged tag, and the archive is byte-identical (`ota-zip.ts`).
 * What must not change is the **announcement**: `createdAt` is carried over from
 * the deployed manifest when the tag matches, so re-deploying the same app does
 * not look like a new release to the replay defence. → `decideChannelEmission`
 *
 * Skipping *work* is a separate question from skipping the write, and it is
 * answered upstream by adaptv's build fingerprint: the caller reuses a cached
 * archive rather than rebuilding and re-zipping. The correctness here does not
 * depend on that cache being right — a stale cache costs time, never a wrong
 * manifest, because the tag is recomputed from whatever bytes are on disk.
 */

/** How much of the content hash names a bundle. 64 bits — see `computeBuildTag`. */
const BUILD_TAG_BYTES = 8

export type ChannelPlan = {
  buildTag: string
  createdAt: number
  /** The deployed channel already advertises this exact build. */
  reused: boolean
}

/**
 * The bundle's identity: a hash of the bytes the app will actually run.
 *
 * Content-addressed rather than a version number or a timestamp, because it has
 * to answer one question — "is this the same app the device is already running?"
 * — from the build output alone, with no state carried between machines. That is
 * what makes a rollback free (the previous tag is still a valid, downloadable
 * name) and a rebuild of unchanged sources a no-op.
 *
 * The path is hashed alongside the bytes, so moving a file to a new name is a
 * different build even when the bytes are identical.
 */
export function computeBuildTag(clientDir: string): string {
  const hash = createHash("sha256")
  for (const rel of listFiles(clientDir).sort()) {
    //NUL separates the fields: it is the one byte a path cannot contain, and with
    //a printable separator `"a b"/"c"` and `"a"/"b c"` would hash to the same
    //build. Written as an ESCAPE — a literal NUL makes this file binary to grep
    //and rg, which then skip it in silence and make a repo-wide search a liar.
    hash.update(rel)
    hash.update("\u0000")
    hash.update(readFileSync(path.join(clientDir, rel)))
    hash.update("\u0000")
  }
  return hash.digest("hex").slice(0, BUILD_TAG_BYTES * 2)
}

/** Every file under `clientDir`, as archive entries with forward-slashed names. */
export function collectBundleEntries(clientDir: string): ZipEntry[] {
  return listFiles(clientDir).map((rel) => ({
    name: rel.split(path.sep).join("/"),
    data: readFileSync(path.join(clientDir, rel)),
  }))
}

/** Build the archive for a client dir. Deterministic for a given directory. */
export function buildBundleArchive(clientDir: string): Buffer {
  const entries = collectBundleEntries(clientDir)
  if (!entries.some((e) => e.name === "index.html")) {
    throw new Error(
      `ota: ${clientDir} has no index.html — that is not a bundle an app can boot`,
    )
  }
  return createZip(entries)
}

/**
 * Decide what this deploy announces, given what the channel already says.
 *
 * The only real decision is `createdAt`. Stamping `Date.now()` unconditionally
 * would make every re-deploy of an identical app a *newer* build than the one
 * devices are running — which is precisely the signal the replay defence reads,
 * so a CI job that deploys on a schedule would keep re-announcing the same bytes
 * as if they were a release.
 *
 * An unreachable or absent channel resolves to "this is new", which is the safe
 * direction: publishing a fresh announcement of the correct bundle costs a
 * redundant download at worst, while inventing an old timestamp for a genuinely
 * new build would make devices reject it.
 */
export function decideChannelEmission(options: {
  buildTag: string
  /** The manifest currently published, or `null` if it could not be read. */
  deployed: UpdateManifest | null
  now: number
}): ChannelPlan {
  const { buildTag, deployed, now } = options
  const same = deployed?.buildTag === buildTag
  return {
    buildTag,
    //Carried from the deployed manifest, not re-stamped. A timestamp that moves
    //while the bytes do not is a lie the devices act on.
    createdAt: same ? deployed.createdAt : now,
    reused: same,
  }
}

/**
 * Read the manifest the channel is currently serving.
 *
 * Never throws and never fails the build. A first deploy 404s by definition, an
 * origin can be behind a VPN the CI runner cannot reach, and a DNS blip is not a
 * reason to refuse to publish — all three mean the same thing here: assume
 * nothing is published and announce this build.
 */
export async function fetchDeployedManifest(
  manifestUrl: string,
  options: { timeoutMs?: number } = {},
): Promise<UpdateManifest | null> {
  try {
    const response = await fetch(manifestUrl, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
      //a CDN edge holding the previous deploy's copy would answer with the wrong
      //`createdAt`, which is the one field this call exists to preserve
      cache: "no-store",
      headers: { accept: "application/json" },
    })
    if (!response.ok) return null
    const parsed: unknown = await response.json()
    return isManifest(parsed) ? parsed : null
  } catch {
    return null
  }
}

export type WrittenChannel = {
  manifestPath: string
  bundlePath: string
  bundleBytes: number
}

/**
 * Write the channel into the built site.
 *
 * `sha256` is over the archive as published — the transport integrity check the
 * plugin verifies after downloading. It is NOT the bundle's identity; the tag is
 * (`ota-zip.ts` explains why the two must not be conflated).
 *
 * `privateKey` produces **both** signatures, and the order they are computed in
 * is forced: the manifest's own signature covers `sha256`, which does not exist
 * until the archive does.
 */
export function writeChannel(options: {
  /** The web build's output dir — the thing the deploy uploads. */
  clientDir: string
  origin: string
  plan: ChannelPlan
  archive: Buffer
  nativeFingerprint: string
  /**
   * PEM PKCS#8 RSA private key. `null` publishes an unsigned channel, which no
   * installed app will accept unless it was built with signing turned off.
   */
  privateKey: string | null
}): WrittenChannel {
  const {
    clientDir,
    origin,
    plan,
    archive,
    nativeFingerprint,
    privateKey,
  } = options
  const dir = path.join(
    clientDir,
    ...OTA_CHANNEL_PATH.split("/").filter(Boolean),
  )
  mkdirSync(dir, { recursive: true })

  const bundleName = `bundle-${plan.buildTag}.zip`
  const bundlePath = path.join(dir, bundleName)
  writeFileSync(bundlePath, archive)

  const signable = {
    buildTag: plan.buildTag,
    url: `${origin}${OTA_CHANNEL_PATH}/${bundleName}`,
    sha256: createHash("sha256").update(archive).digest("hex"),
    nativeFingerprint,
    createdAt: plan.createdAt,
  }

  const manifest: UpdateManifest = {
    ...signable,
    ...(privateKey
      ? {
          //Over the ZIP's bytes — this is the one the plugin verifies natively,
          //and the format is not a guess: `createSign("sha256").sign(pem)` is
          //RSASSA-PKCS1-v1_5 over SHA-256, which is exactly what Android's
          //`SHA256withRSA` and iOS's `rsaSignatureDigestPKCS1v15SHA256` check.
          signature: createSign("sha256")
            .update(archive)
            .sign(privateKey, "base64"),
          //Over the fields around it, which the native check cannot see.
          manifestSignature: createSign("sha256")
            .update(canonicalManifest(signable))
            .sign(privateKey, "base64"),
        }
      : {}),
  }
  const manifestPath = path.join(dir, "manifest.json")
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  return { manifestPath, bundlePath, bundleBytes: archive.length }
}

/**
 * The private key to sign with, from the environment. `null` if there is none.
 *
 * An environment variable rather than a config field, and not negotiable: a
 * config field is committed, and a committed signing key is the same as no
 * signing key. `ADAPTV_OTA_PRIVATE_KEY` carries the PEM itself (what a CI secret
 * store hands you); `ADAPTV_OTA_PRIVATE_KEY_FILE` points at one on disk, for a
 * laptop that keeps it outside the repository.
 */
export function resolveSigningKey(): string | null {
  const inline = process.env.ADAPTV_OTA_PRIVATE_KEY
  if (inline?.includes("PRIVATE KEY")) return inline
  const file = process.env.ADAPTV_OTA_PRIVATE_KEY_FILE
  if (!file) return null
  try {
    return readFileSync(file, "utf8")
  } catch {
    throw new Error(
      `ota: ADAPTV_OTA_PRIVATE_KEY_FILE points at ${file}, which cannot be read`,
    )
  }
}

/**
 * A fresh OTA signing pair.
 *
 * RSA-2048 because that is what both native verifiers accept: Android builds the
 * key through `X509EncodedKeySpec` (SPKI) and iOS through `SecKeyCreateWithData`
 * with `kSecAttrKeyTypeRSA`. SPKI was **measured** to work on both — Apple's
 * documentation says PKCS#1, and its implementation takes either.
 */
export function generateOtaKeyPair(): {
  publicKey: string
  privateKey: string
} {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })
}

/**
 * Whether the public key an app declares is one the native verifiers can load.
 *
 * Checked at build time because the alternative is finding out on a user's
 * device: a key the plugin cannot parse makes it refuse **every** update, and it
 * says so only in a native log nobody is reading.
 */
export function isUsableOtaPublicKey(pem: string): boolean {
  try {
    const key = createPublicKey(pem)
    return (
      key.asymmetricKeyType === "rsa" &&
      key.export({ type: "spki", format: "pem" }).toString().length > 0
    )
  } catch {
    return false
  }
}

/**
 * Whether a private key is the other half of the public key the app ships.
 *
 * The one mismatch nothing downstream can catch. Both halves are individually
 * valid, the build succeeds, the manifest carries a real signature — and every
 * installed app rejects it, because it is checking against a key that did not
 * sign it. The failure surfaces as "no updates are arriving", on devices, with
 * a green CI run behind it.
 *
 * Compared as re-exported SPKI rather than as text, so a PEM that differs only
 * in line endings or a trailing newline is still recognised as the same key.
 */
export function signingKeyMatches(
  publicKey: string,
  privateKey: string,
): boolean {
  try {
    const spki = (key: string) =>
      createPublicKey(key).export({ type: "spki", format: "der" })
    return spki(publicKey).equals(spki(privateKey))
  } catch {
    return false
  }
}

function isManifest(value: unknown): value is UpdateManifest {
  if (typeof value !== "object" || value === null) return false
  const m = value as Record<string, unknown>
  return (
    typeof m.buildTag === "string" &&
    typeof m.url === "string" &&
    typeof m.sha256 === "string" &&
    typeof m.nativeFingerprint === "string" &&
    typeof m.createdAt === "number"
  )
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(abs, base))
    else if (entry.isFile()) out.push(path.relative(base, abs))
  }
  return out
}
