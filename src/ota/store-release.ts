/**
 * The one update that cannot arrive over the air, made observable. → `LIFECYCLE.md §5.6`
 *
 * ## What this state means, and what it does not
 *
 * The channel is publishing builds made against a different native layer than the
 * installed binary has. One fact, and what follows from it is
 * `otaOnNativeSkew`:
 *
 * - **`"install"`** (the default) — the bundles arrive and run. What is frozen is
 *   the native half: anything reaching for plugin code this app does not carry
 *   reports unavailable through the capability hook that wraps it — the
 *   `supported` each one already returns — until a store release lands.
 * - **`"refuse"`** — the bundles are not downloaded at all, and the install stays
 *   on the last one that matched it.
 *
 * 🔴 **A device in this state is not broken** under either policy. It is running,
 * it is checking every launch, and the whole rollback net is still underneath it.
 * What is true is that this install has stopped moving in one direction, and
 * nothing on the device or the channel can end that — only a store update can.
 *
 * Whether that is worth interrupting a working app over is a **product** question
 * and adaptv does not answer it. An app whose server contract moved with the
 * release may genuinely have to block; most should say something and get out of
 * the way. So the framework's job ends at making the fact — and *how long it has
 * been true* — something the app can render.
 *
 * ## Why `since` is persisted rather than counted from this launch
 *
 * The interesting question is never "is this device stranded right now", it is
 * "how long has it been". A prompt that appears on day one and a prompt that
 * appears on day thirty are different products, and only the second can be built
 * on a number that survives relaunches. It lives beside the bundle ledger, in
 * `localStorage`, for the reason given there: the WebView's origin does not change
 * when the bundle underneath it does, so the record outlives what it describes.
 */

const STORAGE_KEY = "adaptv.ota.store-release"

/** A published build made for a newer app than this one, and since when. */
export type StoreReleaseRequired = {
  /**
   * The build tag the channel is offering. Opaque to the user, but the thing to
   * put in a bug report — it identifies the deploy that moved past this binary.
   */
  buildTag: string
  /**
   * When this device **first** found a build made for a native layer it does not
   * have, in ms since the epoch. Not reset by the next one: a channel publishing
   * three such bundles in a row has left this install behind once, for the whole
   * time, and a clock that restarted on each would never grow.
   */
  since: number
}

let snapshot: StoreReleaseRequired | null = read()
const listeners = new Set<() => void>()

/** The current state, or `null` when this install can still take what is published. */
export function getStoreRelease(): StoreReleaseRequired | null {
  return snapshot
}

/** Subscribe to changes. Shaped for `useSyncExternalStore`. */
export function subscribeStoreRelease(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/**
 * Record that the channel is offering `buildTag` and this binary cannot run it.
 *
 * Idempotent on purpose — it is called on every launch that reaches the same
 * answer, and re-notifying identical state would re-render the app for nothing.
 */
export function noteStoreReleaseRequired(buildTag: string): void {
  if (snapshot?.buildTag === buildTag) return
  //`since` is inherited from any record already here, so consecutive refusals
  //read as one continuous stranding rather than a clock that keeps restarting.
  const next = { buildTag, since: snapshot?.since ?? now() }
  snapshot = next
  write(next)
  emit()
}

/**
 * Record that this install can take what the channel is offering after all.
 *
 * 🔴 Called only when a manifest was actually **read and judged** — never on a
 * failed check. A device with no network reaches no conclusion, and clearing on
 * that would make every stranded install look healthy the moment it went offline,
 * which is the one time nobody is around to notice the lie.
 */
export function clearStoreRelease(): void {
  if (snapshot === null) return
  snapshot = null
  wipe()
  emit()
}

function emit(): void {
  for (const listener of listeners) listener()
}

function now(): number {
  return Date.now()
}

/* ============================================================================
 * Persistence — every read degrades to "nothing known", same trade as the ledger
 * ========================================================================== */

function read(): StoreReleaseRequired | null {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as StoreReleaseRequired).buildTag !== "string" ||
      typeof (parsed as StoreReleaseRequired).since !== "number"
    ) {
      return null
    }
    const { buildTag, since } = parsed as StoreReleaseRequired
    return { buildTag, since }
  } catch {
    return null
  }
}

function write(state: StoreReleaseRequired): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    //A device that cannot remember re-learns on the next launch. It loses the
    //age, not the fact, and the fact is what gates the UI.
  }
}

function wipe(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY)
  } catch {}
}

/** Reset module state. Tests only — a launch never has a reason to. */
export function resetStoreReleaseForTests(): void {
  snapshot = null
  wipe()
  listeners.clear()
}
