import type { Bundle, BundleState } from "#adaptv/ota/policy"

/**
 * What this device knows about the bundles it has downloaded. → `docs/design/ota.md §5.4b`
 *
 * ## Why adaptv keeps its own record
 *
 * Every policy decision in `policy.ts` is a function of three things per bundle:
 * its build tag, its **state**, and the **binary it proved itself on**. The
 * plugin stores none of that — `getDownloadedBundles()` returns a list of ids and
 * nothing else. Without a ledger, `selectRollbackTarget` cannot tell a known-good bundle
 * from the one that just failed, and `selectPrunableBundles` cannot tell a bundle
 * this binary has actually booted from one left behind by an older native layer.
 * Both would then be guessing about the thing they exist to protect.
 *
 * ## Why `localStorage`
 *
 * The record has to survive the bundle swap that it describes, so it cannot live
 * inside a bundle. It can, because the WebView's origin (`capacitor://localhost`)
 * does not change when the plugin points the root at a different directory — the
 * document changes, the origin does not. Same reason it survives a rollback,
 * which is exactly when it is read.
 *
 * Every read is defensive. A cleared store, a quota error, a half-written entry
 * from a killed process: all of them degrade to "this device knows nothing",
 * which every caller already handles, because it is also the truth on a first
 * launch.
 */

const STORAGE_KEY = "adaptv.ota.bundles"
const BINARY_KEY = "adaptv.ota.binary"

type BinaryRecord = {
  /** `versionName+versionCode`, straight from the OS. */
  identity: string
  /**
   * The native fingerprint of the **binary**, not of whatever bundle is running
   * on top of it. Read from the embedded bundle, which is the one case where the
   * two are the same thing — see {@link rememberBinary}.
   */
  fingerprint: string | null
}

function readBinary(): BinaryRecord | null {
  try {
    const raw = globalThis.localStorage?.getItem(BINARY_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return null
    const record = parsed as Record<string, unknown>
    if (typeof record.identity !== "string") return null
    return {
      identity: record.identity,
      fingerprint:
        typeof record.fingerprint === "string" ? record.fingerprint : null,
    }
  } catch {
    return null
  }
}

/**
 * The app binary this device last launched under, or `null` on a first launch.
 *
 * Kept beside the bundle ledger because it answers the same kind of question and
 * has to survive the same swap — but it is not about a bundle, it is about the
 * thing underneath every bundle. → `returnToEmbedded` in `updater.ts`
 */
export function lastSeenBinary(): string | null {
  return readBinary()?.identity ?? null
}

/**
 * The native fingerprint of the installed **binary**, or `null` if this device
 * has not been able to work it out yet.
 *
 * 🔴 **Not the same as `otaConfig.nativeFingerprint`**, and the difference is the
 * whole reason this is stored. That constant is baked into the running bundle and
 * describes the machine that BUILT it. Once a bundle made for a newer native
 * layer installs — which is the default (`otaOnNativeSkew: "install"`) — the
 * running bundle claims a fingerprint the binary underneath it does not have, and
 * every comparison against it reads "up to date" for an app that is not.
 * → `docs/design/ota.md §5.6`
 */
export function binaryFingerprint(): string | null {
  return readBinary()?.fingerprint ?? null
}

/**
 * Record the binary now running. Written **before** the reload that acts on a
 * change, and only once the reset it follows has landed.
 *
 * `fingerprint` is only ever passed when the **embedded** bundle is the one
 * executing, because that is the single moment the two fingerprints coincide: the
 * embedded bundle ships inside the binary, built from the same native project in
 * the same breath. Every other bundle arrived later and knows only its own. That
 * moment is guaranteed to come around — a store release drops the device back to
 * the embedded bundle before anything else runs (`returnToEmbedded`) — so the
 * value is re-learned on exactly the launches where it changed.
 *
 * Omitting it keeps whatever was known **of the same binary**, rather than
 * overwriting a true value with a bundle's own claim. A binary that has just
 * changed drops back to `null` instead: the fingerprint of the app that was here
 * yesterday is not a worse guess than nothing, it is a wrong answer with the
 * confidence of a right one.
 */
export function rememberBinary(
  identity: string,
  fingerprint?: string,
): void {
  const known = readBinary()
  const record: BinaryRecord = {
    identity,
    fingerprint:
      fingerprint ??
      (known?.identity === identity ? known.fingerprint : null),
  }
  try {
    globalThis.localStorage?.setItem(BINARY_KEY, JSON.stringify(record))
  } catch {
    //Same trade as the ledger: a device that cannot remember re-checks next
    //launch, which costs a comparison and never a wrong answer.
  }
}

/** A bundle, plus when the channel said it was published. */
export type LedgerEntry = Bundle & {
  /**
   * `createdAt` of the manifest this bundle was installed from.
   *
   * The running build's own copy of this is what arms the replay defence
   * (`decideUpdate`), and it is kept **here** rather than inside the bundle for a
   * reason that is not obvious: the build tag is a content hash, so anything
   * written into the bundle changes the tag that describes it. A timestamp baked
   * in at build time would give every rebuild a new identity and make an
   * unchanged app look like a release on every deploy.
   */
  createdAt: number
}

/** Newest last — the order `policy.ts` reads when it takes a tail. */
export function readLedger(): LedgerEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch {
    return []
  }
}

/**
 * Record a bundle that has just been downloaded and staged for the next launch.
 *
 * Written **before** the pointer is flipped, not after: a process killed between
 * the two leaves a bundle on disk the ledger knows about (harmless, and pruned
 * later), whereas the other order leaves one it does not (invisible, never
 * pruned, and a rollback target it will refuse to consider).
 */
export function recordStaged(entry: {
  buildTag: string
  createdAt: number
}): void {
  write([
    ...readLedger().filter((b) => b.buildTag !== entry.buildTag),
    { ...entry, state: "pending" },
  ])
}

/**
 * Move a bundle to a new state, if this device has heard of it.
 *
 * `provenOn` is the binary identity the bundle reached this state under, and it
 * is what {@link proven} later filters on. Pass it with `known-good`: a bundle
 * that booted is only evidence about the binary it booted on.
 */
export function markState(
  buildTag: string,
  state: BundleState,
  provenOn?: string,
): void {
  const ledger = readLedger()
  const found = ledger.find((b) => b.buildTag === buildTag)
  if (!found) return
  const nextProvenOn = provenOn ?? found.provenOn
  if (found.state === state && found.provenOn === nextProvenOn) return
  found.state = state
  found.provenOn = nextProvenOn
  write(ledger)
}

/** Drop entries for bundles that are no longer on disk. */
export function forget(buildTags: readonly string[]): void {
  if (buildTags.length === 0) return
  write(readLedger().filter((b) => !buildTags.includes(b.buildTag)))
}

/** When the channel said the running build was published, if this device knows. */
export function createdAtOf(buildTag: string): number | undefined {
  return readLedger().find((b) => b.buildTag === buildTag)?.createdAt
}

/**
 * Bundles that have booted on **this** binary — the ones this device has direct
 * evidence about.
 *
 * The evidence is what makes this the right filter. Comparing native
 * fingerprints, which is what this used to do, only ever *inferred* runnability:
 * it asked whether a bundle was built against the same plugin set, which under
 * the default skew policy is no longer the same question as whether it runs.
 * A bundle built for a newer native layer installs, boots, and works with one
 * feature dark — and a fingerprint filter would refuse to roll back to it and
 * delete it as unrunnable, leaving the device to fall back years.
 *
 * ⚠︎ The binary identity still has to be checked, and that is the half a plain
 * `state === "known-good"` would lose. A store release swaps the native layer
 * under bundles that were healthy the day before; those proved themselves on an
 * app that no longer exists.
 */
export function proven(
  binaryIdentity: string,
  ledger: readonly LedgerEntry[] = readLedger(),
): LedgerEntry[] {
  return ledger.filter(
    (b) => b.state === "known-good" && b.provenOn === binaryIdentity,
  )
}

function write(entries: LedgerEntry[]): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    //A full or disabled store costs this device its history, not its ability to
    //run: every reader treats an empty ledger as a first launch.
  }
}

const STATES: readonly BundleState[] = [
  "pending",
  "active",
  "known-good",
  "failed",
]

function isEntry(value: unknown): value is LedgerEntry {
  if (typeof value !== "object" || value === null) return false
  const e = value as Record<string, unknown>
  return (
    typeof e.buildTag === "string" &&
    typeof e.createdAt === "number" &&
    (e.provenOn === undefined || typeof e.provenOn === "string") &&
    STATES.includes(e.state as BundleState)
  )
}
