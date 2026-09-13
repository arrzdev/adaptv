// Device targeting for `adaptv dev`. adaptv owns device selection (rather than letting
// Capacitor's opaque picker handle it) so it can REMEMBER the choice: pick once with the
// arrow keys, then `--latest` reuses it. The pick lives in the `devices` section of
// `.adaptv/state.json` (git-ignored with the rest of `.adaptv/`). → plan Part 3.
import { capture } from "./exec.mjs"
import { capCmd } from "./native.mjs"
import { canPrompt, runLine, select } from "./render.mjs"
import { readSection, writeSection } from "./state.mjs"

/**
 * How long a device listing may take before adaptv stops waiting on it. A listing costs
 * 176-279ms; this is not a performance budget, it is the ceiling on a platform service that
 * has stopped answering at all, which is a real state a dev machine gets into and which
 * otherwise hangs the run with no row, no reason and no way out but ctrl-c (R59).
 */
const LIST_TIMEOUT_MS = 30_000

/** Why a listing never came back, and the one command that fixes it (R13). */
const NO_ANSWER = {
  ios: "the iOS simulator service stopped responding. Restart it with 'sudo launchctl kickstart -k system/com.apple.CoreSimulator.simdiskimaged', or reboot",
  android:
    "the Android device bridge stopped responding. Restart it with 'adb kill-server'",
}

/** A listing slower than this earns a live row; a fast one must not flash one up. */
const ROW_AFTER_MS = 400

/**
 * Await a device listing with a row the dev can see.
 *
 * Resolving the device used to be the one stretch of `dev` with NO live row: the web line
 * settled, and then the CLI sat silently inside `simctl`/`adb` until the picker appeared.
 * When the platform service wedges, that silence is the whole failure — the dev reads it as
 * "web was the only thing that ran" (R59).
 *
 * The row is deferred rather than immediate because the listing is normally faster than the
 * eye: mounting and erasing a region for 200ms is a blip, not information.
 */
async function searching(platform, list) {
  const work = list()
  //`work` is settled here only to time it; the value and any rejection are taken from it
  //again below, so nothing is swallowed.
  const outcome = await Promise.race([
    work.then(
      () => "done",
      () => "done",
    ),
    new Promise((resolve) => {
      const t = setTimeout(() => resolve("slow"), ROW_AFTER_MS)
      t.unref?.()
    }),
  ])
  if (outcome === "done") return work
  return runLine(
    platform,
    async (report) => {
      report("looking for devices")
      return await work
    },
    { transient: true },
  )
}

const readDevices = (appRoot) => readSection(appRoot, "devices")

/** The remembered `{ id, name }` for a platform (`--latest`), or null. */
export function cachedDevice(appRoot, platform) {
  return readDevices(appRoot)[platform] ?? null
}

function rememberDevice(appRoot, platform, device) {
  writeSection(appRoot, "devices", {
    ...readDevices(appRoot),
    [platform]: device,
  })
}

/**
 * List runnable targets via `cap run <platform> --list --json`. Capacitor emits a
 * clean `[{ name, api, id }]` array on stdout (logs go to stderr). Entries without a
 * usable id are dropped.
 */
export async function listTargets(appRoot, platform, env) {
  const { cmd, pre } = capCmd(appRoot)
  const { stdout, timedOut } = await capture(
    cmd,
    [...pre, "run", platform, "--list", "--json"],
    { cwd: appRoot, env, timeoutMs: LIST_TIMEOUT_MS },
  )
  if (timedOut) {
    throw new Error(
      NO_ANSWER[platform] ??
        `the ${platform} device service stopped responding`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(stdout.trim())
  } catch {
    const match = stdout.match(/\[[\s\S]*\]/)
    parsed = match ? JSON.parse(match[0]) : []
  }
  return dedupeTargets(
    (Array.isArray(parsed) ? parsed : []).filter(
      (t) => t?.id && t.id !== "?",
    ),
  )
}

/**
 * One row per DEVICE, keyed on its id.
 *
 * The listing walks the installed runtimes and collects each one's devices, and two runtimes
 * can share an identifier: `xcodebuild -downloadPlatform iOS` installed iOS 26.1 build 23B86
 * next to the 23B80 already there, and both call themselves
 * `com.apple.CoreSimulator.SimRuntime.iOS-26-1` (`simctl list devices` prints two `-- iOS
 * 26.1 --` sections, the first of them empty). Every 26.1 device was then collected once per
 * runtime and the picker offered 59 rows for 36 devices — all 23 simulators on that version
 * twice, same name, same version hint, SAME id (R62).
 *
 * Which is worse than the ambiguity R60 fixed: there, two rows meant two devices and the
 * hint could tell them apart. Here both rows ARE one device, so no hint could exist, and
 * whichever the dev picks is the same pick. Dropping the repeat is the only honest answer.
 * First wins, so the order the listing chose is kept.
 */
export function dedupeTargets(targets) {
  const seen = new Set()
  return (targets ?? []).filter((t) => {
    if (seen.has(t.id)) return false
    seen.add(t.id)
    return true
  })
}

/**
 * API level → the Android version a person actually says. Only the levels adaptv can run on;
 * anything outside the table keeps its level rather than being guessed at.
 */
const ANDROID_VERSION = {
  21: "5.0",
  22: "5.1",
  23: "6.0",
  24: "7.0",
  25: "7.1",
  26: "8.0",
  27: "8.1",
  28: "9",
  29: "10",
  30: "11",
  31: "12",
  32: "12L",
  33: "13",
  34: "14",
  35: "15",
  36: "16",
}

/**
 * What tells two identically-named devices apart in the picker.
 *
 * With more than one runtime installed the list is FULL of exact duplicates — two
 * `iPhone 16 Pro (simulator)` rows, one on each iOS version — and picking between them was a
 * coin toss (R60). The version is the only thing that differs, so it is the only thing worth
 * printing; a device with nothing to disambiguate it gets no hint rather than a filler one.
 *
 * The two platforms have to READ the same, and left alone they do not: the upstream field is
 * spelled `iOS 26.1` on one side and `API 34` on the other — a version on one, an SDK level on
 * the other, which is not the same fact and is not what the dev picked when they created the
 * device. `API 34` becomes `Android 14`. A level with no entry in the table keeps its own
 * spelling: an unrecognised one still disambiguates the row, and inventing a version number for
 * a release adaptv has never seen would be worse than saying less.
 */
export function versionHint(target) {
  //iOS arrives already spelled for a human, so it passes through untouched — prefixing the
  //platform onto it prints `· iOS iOS 26.1`, which is how this was first shipped and caught.
  const api = target.api
  if (!api) return undefined
  //The MAJOR decides the name. Levels arrive with a minor part too (`API 36.1`) now that
  //Google ships minor SDK versions inside a release — a real emulator here reported
  //`API 37.1` — and those are still the same Android version, so matching whole numbers
  //only dropped a row back to naming a level nobody chose an emulator by.
  const level = /^API (\d+)(?:\.\d+)?$/.exec(api)
  if (!level) return api
  const version = ANDROID_VERSION[Number(level[1])]
  return version ? `Android ${version}` : api
}

/**
 * Is this row a simulator or an emulator rather than a device in somebody's hand?
 *
 * Read from the listing alone, because it already says: a virtual row is named with a
 * `(simulator)` or `(emulator)` suffix, which the listing appends from its own virtual flag and
 * nothing else. The one exception is an emulator that is already RUNNING — the listing collects
 * it with the attached devices, by its `emulator-NNNN` serial and with no suffix, and it is still
 * an emulator. `isPhysicalTarget` in native.mjs answers the same question for one id, with a
 * device call; this one has the whole row and needs none.
 */
function isVirtual(target) {
  return (
    / \((simulator|emulator)\)$/.test(target.name ?? "") ||
    /^emulator-\d+$/.test(target.id)
  )
}

/**
 * The device a run nobody can answer lands on: the first simulator or emulator, and a physical
 * device only when there is nothing else.
 *
 * The listing puts every attached device BEFORE every virtual one, so "the first row" — which is
 * what R34 records a picker taking off a TTY, on the grounds that any simulator will do — was
 * the phone whenever one was plugged in. A `preview ios` in CI or with stdin from /dev/null then
 * installed on the owner's iPhone. Order among the virtual rows is the listing's own, so a
 * running emulator still comes before an AVD that would have to boot.
 */
function unattendedTarget(targets) {
  return targets.find(isVirtual) ?? targets[0]
}

/**
 * Present the branded picker for a fresh list and return `{ id, name, source }`, remembering
 * the device only when a person chose it.
 */
async function pickAndCache(appRoot, platform, env, listed) {
  let targets = listed
    ? await listed()
    : await searching(platform, () => listTargets(appRoot, platform, env))
  //An EMPTY prefetched list is the one answer that must never be trusted — a simulator that
  //booted during the warm would otherwise be reported as "no devices found".
  if (targets.length === 0)
    targets = await searching(platform, () =>
      listTargets(appRoot, platform, env),
    )
  if (targets.length === 0) {
    throw new Error(
      `no ${platform} devices or simulators found. Boot a simulator/emulator (or connect a device) and try again.`,
    )
  }
  //Asked BEFORE the picker, because the picker is what would answer it: off a TTY `select`
  //returns without anybody having chosen.
  const asked = canPrompt()
  const id = await select(
    //Lowercase, and a question — the voice `confirm()` already asks in ('replace 11 icons in
    //public/icons?'). `Choose a ios device` was also the one line of adaptv's output with an
    //article it could not get right (R65).
    `which ${platform} device?`,
    //The rows keep the listing's order, phones first: a person reads them and chooses. Only
    //the answer given on nobody's behalf prefers a simulator.
    targets.map((t) => ({
      value: t.id,
      label: t.name,
      hint: versionHint(t),
    })),
    { unattended: unattendedTarget(targets).id },
  )
  const device = { id, name: targets.find((t) => t.id === id)?.name ?? id }
  //`--latest` is "the last device you picked". A run that answered for itself picked nothing,
  //and remembering its answer would quietly replace the device the dev did pick — the next
  //`dev ios --latest` at their own terminal would land on whatever a CI run chose.
  if (asked) rememberDevice(appRoot, platform, device)
  return { ...device, source: "picked" }
}

/**
 * Resolve the target device for a run, honouring precedence:
 *   1. `--target <id>` → use it (and remember it)
 *   2. `--latest`      → the cached device; falls back to the picker if none
 *   3. otherwise       → the interactive picker; off a TTY, the first simulator or emulator
 *                        (a physical device only when nothing else is listed), not remembered
 * Returns `{ id, name, source }` where source is "target" | "latest" | "picked".
 * `command` is the one the dev ran (`dev`, `preview`), so an error suggests rerunning THAT.
 */
export async function resolveTarget(
  appRoot,
  platform,
  env,
  { command, target, latest, prefetch = null },
) {
  /**
   * The device list, from a listing started earlier if one was.
   *
   * `dev` sits idle for ~1.9s warming the dev server, and listing devices costs 176-279ms per
   * platform — a whole node process, the Capacitor CLI and `simctl`/`adb`. Starting it during
   * that wait is free wall-clock.
   *
   * THE BOUNDING RULE: a prefetched answer may only ever be used to SUCCEED. Every negative
   * below re-lists first, because the prefetch was taken up to two seconds ago and a device
   * booted in the meantime must not turn a run that would have worked into one that fails.
   * The only residual effect is a device that appeared mid-warm being absent from a
   * NON-empty picker list — visible, and fixed by running again.
   */
  //The row wraps the WHOLE wait, the prefetch included: the prefetch is itself a listing, so
  //when the platform service is the thing that has stopped answering, waiting on it is
  //exactly as silent as listing again would be.
  const listed = () =>
    searching(
      platform,
      async () =>
        (prefetch ? await prefetch.catch(() => null) : null) ??
        (await listTargets(appRoot, platform, env)),
    )
  const fresh = () =>
    searching(platform, () => listTargets(appRoot, platform, env))
  if (target) {
    let known = (await listed()).find((t) => t.id === target)
    //Not found in a possibly-stale list is exactly the case that must re-ask.
    if (!known) known = (await fresh()).find((t) => t.id === target)
    // Validate BEFORE caching — otherwise a typo'd `--target` gets remembered and every
    // later `--latest` fails against a device that was never real.
    if (!known) {
      throw new Error(
        `unknown ${platform} device "${target}". Run 'adaptv ${command} ${platform}' to pick from the current list.`,
      )
    }
    const device = { id: target, name: known.name ?? target }
    rememberDevice(appRoot, platform, device)
    return { ...device, source: "target" }
  }

  if (latest) {
    const cached = cachedDevice(appRoot, platform)
    if (cached?.id) {
      // Remembered — but a saved pick goes stale: the simulator was shut down, the emulator
      // never started, the phone was unplugged. Returning it anyway pushed the problem to
      // the launch, which failed the whole platform ("device isn't available right now") and
      // told the dev to re-run a DIFFERENT command to recover. `--latest` means "don't ask me
      // again", not "fail if my last choice is gone" — so when it isn't there, quietly fall
      // through to the picker, which is what the dev would have had to do by hand anyway.
      let available = await listed()
      if (!available.some((t) => t.id === cached.id))
        available = await fresh()
      if (available.some((t) => t.id === cached.id))
        // the "latest" tag is surfaced on the launch line, not as its own log line.
        return { ...cached, source: "latest" }
    }
    // No usable cache — fall through to the picker. The picker itself makes the ask
    // obvious ("which <platform> device?"), so announcing it first is noise.
  }

  return pickAndCache(appRoot, platform, env, listed)
}
