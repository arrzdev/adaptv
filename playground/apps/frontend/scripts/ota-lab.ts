import { execFileSync } from "node:child_process"
import { createHash, createVerify } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import { createInterface } from "node:readline/promises"
import { pathToFileURL } from "node:url"

// `tsx scripts/ota-lab.ts` — a bench for watching an over-the-air update actually happen.
//
// ## Why this exists as a script and not as instructions
//
// The OTA loop is only observable across THREE app launches, and the interesting
// part is what does NOT happen on two of them. Driven by hand it is very easy to
// mis-attribute: you relaunch, nothing changed, and you cannot tell whether the
// download failed, the pointer did not flip, or you simply relaunched one time too
// few. So the bench prints what it expects to happen next, every time, and the
// value is in the mismatch.
//
// ## The expected sequence — read this before blaming anything
//
//   publish        → the channel now offers a DIFFERENT bundle than the app runs
//   launch 1       → app checks, downloads in background, keeps running the OLD one
//                    ✗ nothing visible. This is correct.
//   launch 2       → cold start reads the pointer BEFORE the WebView loads
//                    ✓ a bar reading "OTA · <NAME>" appears across the bottom.
//                      That bar exists ONLY in a published bundle — the app as
//                      installed has none — so seeing it is the update itself.
//   launch 3       → same as 2. Nothing new.
//
// **It is launch 2, not launch 3.** A frequent (and reasonable) guess is that the
// swap needs one more restart, because "apply on next launch" sounds like it
// happens after the launch that downloaded. It does not: the download finishes
// during launch 1, and launch 2's cold start is already the next launch. If you
// only see it on launch 3, the download did not finish in time — which is a real
// finding, not a quirk to wave off, and it means the check is starting too late.
//
// ## ⚠︎ The very first launch after `fresh` is the exception
//
// It applies the update **immediately**, on launch 1, badge and all. That is not
// the loop misbehaving — it is `startOtaUpdates`' first-launch path: a device with
// nothing cached holds the splash, downloads, and reloads, rather than showing a
// brand new user a version of the product that no longer exists. There is no
// session to tear on a launch that has not finished starting. → `decideFirstLaunch`
//
// So: badge on launch 1 immediately after `fresh` = correct. Badge on launch 1
// after any later `publish` = wrong, and worth chasing.
//
// ## The third check: `publish`, then touch nothing for five minutes
//
// This app sets `otaPollMinutes: 5` — the floor, and not a number any shipped app
// wants (the default is 60). It is here so the poll is watchable: publish, leave
// the app open and in the foreground, and the download happens DURING the session,
// with no launch and no resume involved.
//
//   publish        → then do not touch the simulator
//   +5 min         → ✗ still nothing visible. The bundle is on disk and staged.
//   launch 1       → ✓ the badge. ONE relaunch, not two — the download that used
//                    to cost a launch already happened.
//
// A badge appearing WITHOUT a relaunch is the bug this found: `decideFirstLaunch`
// answers `"wait"` from a value read once at start-up, so on an install with
// nothing proven yet every later check kept that answer and applied the bundle in
// place, replacing the document under a mounted app. The reload is now gated on
// the launch screen still being up. → `launchScreenStillUp` in `updater.ts`
//
// To watch the download without disturbing the session (backgrounding the app to
// read its localStorage would fire a resume check and prove nothing about the
// timer), watch the host filesystem instead — the plugin unpacks to
// `<DataContainer>/Library/NoCloud/ionic_built_snapshots/<buildTag>/`.
//
// ## What "publishing" is here, and why it is not a deployment system
//
// A channel is two static files in a folder: `manifest.json` and one zip, under
// `.well-known/adaptv/ota/`. That is the whole thing in production too — they ride
// along inside the ordinary web deploy, so there is no OTA server anywhere
// (`docs/design/ota.md §5.2`). Here they are served by a plain static file server on a
// port. "Publishing v2" is overwriting two files. "Rolling back" is putting the
// old two back.
//
// ## The bench runs signed, like production
//
// Both files are written by adaptv's own `writeChannel`, and both signatures are
// real. That is deliberate: the unsigned path (`ADAPTV_OTA_ALLOW_UNSIGNED`) is a
// local escape hatch, and verifying it on a device proves the download works while
// proving nothing about the gate a real update has to pass — two signatures,
// checked in two places, by code in two languages. The bench keeps a throwaway
// pair under `.adaptv/ota-lab/`; `fresh` rotates it, and nothing else may, because
// the public half is baked into the installed binary.

const HERE = process.cwd()
const CHANNEL_PORT = Number(process.env.ADAPTV_OTA_PORT ?? 41790)
// Deliberately OUTSIDE `dist/`: every build wipes that directory, and the channel
// has to survive across builds — it is the thing the old app talks to while the
// new one is being made. `.adaptv/` is where adaptv already keeps generated state.
const CHANNEL_DIR = path.join(HERE, ".adaptv/ota-lab/channel")
const CONFIG = path.join(HERE, "adaptv.config.ts")
const APP_ID = "dev.arrz.projectzero"

/**
 * Which of the two natives this run drives. `ADAPTV_OTA_PLATFORM=android`.
 *
 * ⚠︎ **Android is not a formality here.** The zip's signature is checked by a
 * different implementation on each platform — `X509EncodedKeySpec` +
 * `SHA256withRSA` there, `SecKeyCreateWithData` + `rsaSignatureDigestPKCS1v15SHA256`
 * here — and a key shape one accepts and the other does not produces a channel
 * that works perfectly on half the installed base. Nothing but running it says.
 */
const PLATFORM =
  process.env.ADAPTV_OTA_PLATFORM === "android" ? "android" : "ios"

/** A running device of {@link PLATFORM}: an adb serial or a simulator UDID. */
type Device = { id: string; name: string }

/**
 * What is running right now: adb's attached devices, or the booted simulators.
 *
 * Only RUNNING ones, because every step after `install` drives the device the
 * app is already on, and a simulator that is shut down cannot be relaunched,
 * suspended or uninstalled from. A cabled iPhone is never listed: `simctl` cannot
 * drive it, so the bench is simulator-only on iOS.
 */
function runningDevices(): Device[] {
  if (PLATFORM === "android") {
    return execFileSync("adb", ["devices", "-l"], { encoding: "utf8" })
      .split("\n")
      .slice(1)
      .map((line) => line.trim().split(/\s+/))
      .filter(([, state]) => state === "device")
      .map(([id = "", , ...rest]) => ({
        id,
        name:
          rest.find((field) => field.startsWith("model:"))?.slice(6) ?? id,
      }))
  }
  const { devices } = JSON.parse(
    execFileSync("xcrun", ["simctl", "list", "devices", "--json"], {
      encoding: "utf8",
    }),
  ) as {
    devices: Record<
      string,
      { udid: string; name: string; state: string }[]
    >
  }
  //iPhone and iPad runtimes only: a booted Watch or TV simulator is not somewhere the app
  //can be installed, and counting it would refuse a run with one real candidate
  return Object.entries(devices)
    .filter(([runtime]) =>
      runtime.startsWith("com.apple.CoreSimulator.SimRuntime.iOS-"),
    )
    .flatMap(([, sims]) => sims)
    .filter((sim) => sim.state === "Booted")
    .map((sim) => ({ id: sim.udid, name: sim.name }))
}

/**
 * The one device this run drives. `ADAPTV_OTA_TARGET=<adb serial | simulator UDID>`.
 *
 * ⚠︎ **Resolved once, and named in every call.** On a shared machine a second
 * emulator, a second booted simulator or a cabled iPhone is the ordinary case, and
 * each tool fails differently without a name: a bare `adb` refuses with "more than
 * one device/emulator" (swallowed by {@link reachChannel}, so the port is never
 * reversed and the app asks the channel for nothing),
 * `simctl … booted` picks one of the simulators arbitrarily — so `relaunch` can
 * restart an app on a device you are not looking at — and `adaptv preview` waits
 * on its device picker for an answer a script never gives.
 *
 * With no target and exactly one running device, that one. With none or several,
 * the step fails before touching anything and lists what is running. The id is
 * the one `adaptv preview <platform> --target` takes for a running device.
 */
let targetCache: string | null = null
function target(): string {
  if (targetCache) return targetCache
  const wanted = process.env.ADAPTV_OTA_TARGET?.trim()
  const running = runningDevices()
  const listed = running
    .map((device) => `\n    ${device.id}  ${device.name}`)
    .join("")
  if (wanted) {
    if (!running.some((device) => device.id === wanted)) {
      throw new Error(
        `ota-lab: ADAPTV_OTA_TARGET=${wanted} is not a running ${PLATFORM} device.` +
          (running.length ? ` Running:${listed}` : " Nothing is running."),
      )
    }
    targetCache = wanted
    return wanted
  }
  if (running.length === 1 && running[0]) {
    targetCache = running[0].id
    return targetCache
  }
  throw new Error(
    running.length === 0
      ? `ota-lab: no ${PLATFORM} device is running — ${PLATFORM === "ios" ? "boot a simulator" : "boot an emulator or attach a device"}, and run this again`
      : `ota-lab: ${running.length} ${PLATFORM} devices are running — name one with ADAPTV_OTA_TARGET=<id>:${listed}`,
  )
}

/**
 * The id actually on the device, resolved rather than assumed.
 *
 * `adaptv preview` installs under `<appId>.dev` so a preview build can sit beside
 * a store build instead of replacing it. Hardcoding the plain id made `relaunch`
 * a no-op that reported success: `simctl terminate` on an unknown id is ignored,
 * and the bench then blamed the update for a colour that never had a reason to
 * change. Ask the device instead.
 */
function bundleId(device: string): string {
  const appId = APP_ID
  try {
    const installed =
      PLATFORM === "android"
        ? execFileSync(
            "adb",
            ["-s", device, "shell", "pm", "list", "packages", appId],
            { encoding: "utf8" },
          )
        : execFileSync("xcrun", ["simctl", "listapps", device], {
            encoding: "utf8",
          })
    return installed.includes(`${appId}.dev`) ? `${appId}.dev` : appId
  } catch {
    return appId
  }
}
/** A symlink to the framework, so the bench uses adaptv's OWN code, not a copy. */
const ADAPTV_ROOT = path.join(HERE, "node_modules/adaptv")

/**
 * The channel's address — handed to the BUILD, never to the running device.
 *
 * `origin` is baked into the binary precisely because it must not be
 * changeable at runtime: a store-shipped app that could be told where to fetch
 * its own code from would be an open door. `ADAPTV_OTA_ORIGIN` is the build-time
 * override that lets a local channel stand in for the real one without editing —
 * and therefore without risking committing — that permanent value.
 */
const OTA_ORIGIN = `http://localhost:${CHANNEL_PORT}`

/**
 * The bench's throwaway signing pair, kept where nothing commits it.
 *
 * ⚠︎ The private half is here because it is worth **nothing** — it signs a channel
 * on localhost for an app on a simulator. A real one belongs in a secret store,
 * and `adaptv keys ota` deliberately prints it once rather than writing it
 * anywhere, for exactly the reason this comment has to exist.
 */
const KEY_DIR = path.join(HERE, ".adaptv/ota-lab")
const PRIVATE_KEY = path.join(KEY_DIR, "signing.key.pem")
const PUBLIC_KEY = path.join(KEY_DIR, "signing.pub.pem")

/**
 * Every build here needs ALL THREE, and `publish` needs them as much as `install`.
 *
 * Miss the origin on `publish` and the bench fails in a way that looks like
 * success: the update installs once, and the bundle it installs was built without
 * a channel address, so it never asks again. One hop, then silence.
 *
 * ⚠︎ The bench runs **signed**, like production, rather than through
 * `ADAPTV_OTA_ALLOW_UNSIGNED`. Verifying the unsigned path on a device proves the
 * download works and proves nothing about the thing that actually gates a real
 * update: two signatures, checked in two places, by code in two languages. That
 * is the part with no unit test that can stand in for a device.
 *
 * `ADAPTV_OTA_PUBLIC_KEY` is honoured only alongside `ADAPTV_OTA_ORIGIN` (see
 * `src/ota/build/ota-config-module.ts`), so no production build can be re-pointed at a
 * bench key by one variable.
 */
async function otaEnv(): Promise<Record<string, string>> {
  return {
    ADAPTV_OTA_ORIGIN: OTA_ORIGIN,
    ADAPTV_OTA_PUBLIC_KEY: (await signingPair()).publicKey,
  }
}

/**
 * The pair this bench signs with, generated on first use.
 *
 * 🔴 Regenerating it **strands the installed app**, and that is not a bug in the
 * bench — it is the production failure, reproduced. The public half is baked into
 * the binary at install time, so a new pair means every future publish is signed
 * by a key the app on the device does not trust, and it refuses each one in
 * silence. The way out is the same as production's: a new install. `fresh` does
 * that, which is why `fresh` is the step that rotates the key.
 */
async function signingPair(): Promise<{
  publicKey: string
  privateKey: string
}> {
  if (existsSync(PRIVATE_KEY) && existsSync(PUBLIC_KEY)) {
    return {
      publicKey: readFileSync(PUBLIC_KEY, "utf8"),
      privateKey: readFileSync(PRIVATE_KEY, "utf8"),
    }
  }
  return await newSigningPair()
}

async function newSigningPair(): Promise<{
  publicKey: string
  privateKey: string
}> {
  //The framework's generator, not a copy of its parameters. A bench that picked
  //its own key shape could pass against a shape production never emits — and the
  //shape is the whole question here, because two native verifiers have to load it.
  const { generateOtaKeyPair } = await otaEmit()
  const pair = generateOtaKeyPair()
  mkdirSync(KEY_DIR, { recursive: true })
  writeFileSync(PUBLIC_KEY, pair.publicKey)
  writeFileSync(PRIVATE_KEY, pair.privateKey, { mode: 0o600 })
  return pair
}

/**
 * adaptv's channel emitter, imported rather than reimplemented.
 *
 * Same reasoning as {@link nativeFingerprint}, and it matters more here: the bytes
 * this writes are the bytes the device verifies. A bench that hand-rolled its own
 * manifest would be testing the bench's idea of a channel, and the one field it
 * got subtly wrong — a canonical form, a signature's input — is the field with no
 * symptom but "updates stopped arriving".
 */
async function otaEmit() {
  return await import(
    pathToFileURL(path.join(ADAPTV_ROOT, "src/ota/build/ota-emit.ts")).href
  )
}

/**
 * The directory the native build writes, read from the framework's own constant.
 *
 * 🔴 Hard-coding this is how the bench lies. It was `dist/client`, adaptv moved the
 * native bundle to `.adaptv/web`, and nothing failed: `publish` went on hashing and
 * zipping the stale `dist/client` from a previous session, so every "published"
 * bundle carried that session's JavaScript — including its **public key**, which no
 * longer matched the key the freshly installed binary trusts. The device fetched
 * each manifest, failed the signature silently (that is the designed behaviour) and
 * refused every update.
 *
 * It stayed invisible because the badge is stamped straight into a CSS asset, so
 * the colour still changed in `dist/client` and the ladder still read green through
 * the first hop — the one hop the EMBEDDED bundle, which did have the right key,
 * was able to accept. Measured on an iOS simulator: `.adaptv/web` held
 * `index-4FCj-1_6.js` trusting key `57c3f13b`, while the published zip held
 * `index-ZXJLbVZT.js` from four hours earlier trusting `259536e1`.
 *
 * Same rule as {@link otaEmit} and {@link nativeFingerprint}, one level up: the
 * bench may choose *where its channel lands*, never *what the framework builds*.
 */
let clientDirCache: string | null = null
async function clientDir(): Promise<string> {
  if (clientDirCache) return clientDirCache
  const { CAPACITOR_WEB_DIR } = await import(
    pathToFileURL(path.join(ADAPTV_ROOT, "src/vite/capacitor-config.ts"))
      .href
  )
  clientDirCache = path.join(HERE, CAPACITOR_WEB_DIR)
  return clientDirCache
}

/**
 * Colours that are impossible to mistake for each other across a room.
 *
 * The point of the visual change is that it needs no interpretation — if you have
 * to squint to decide whether the update landed, the bench has failed at its one
 * job.
 *
 * ⚠︎ `themeColor` on its own is NOT that signal, and believing it was cost a whole
 * debugging session. It paints `<html>`, and the app paints its own surface on
 * top of it, so a bundle that swapped perfectly looks byte-identical on screen.
 * Measured: the installed bundle's `index.html` carried
 * `background-color:#e6fffb` and the screenshot came back `#eeeeec` — the app's
 * own colour, from the first frame. The palette is kept because it names each
 * version and drives the system chrome; {@link stampBadge} is what you actually
 * look at.
 */
const PALETTE = [
  { name: "slate", light: "#eeeeec", dark: "#0a0a0c" },
  { name: "amber", light: "#fff7e6", dark: "#3b2600" },
  { name: "teal", light: "#e6fffb", dark: "#00332e" },
  { name: "violet", light: "#f5e6ff", dark: "#1e0033" },
] as const

// ─── the channel ─────────────────────────────────────────────────────────────

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(abs, base))
    else if (entry.isFile()) out.push(path.relative(base, abs))
  }
  return out
}

/**
 * Stamp the version's name across the bottom of the built client.
 *
 * It rides in the zip like every other byte the update carries, so if you can see
 * it, the bundle on the device is the one this channel published — there is no
 * other way it could have got there.
 *
 * ⚠︎ A **pseudo-element**, not a `<div>` injected into `index.html`. That was the
 * first attempt and it never appeared once: the app renders the whole document,
 * so React reconciles `<body>` on hydration and removes any child it did not put
 * there. `html::after` is not a node, so there is nothing for React to remove —
 * and appending to a hashed CSS file does not change the filename the HTML
 * already references.
 *
 * The app as installed from the "store" carries no badge. **The badge appearing
 * at all is the signal**; after that, the name on it is which version you are on.
 */
async function stampBadge(colour: Colour): Promise<void> {
  const CLIENT_DIR = await clientDir()
  const rule =
    `\nhtml::after{content:"OTA · ${colour.name.toUpperCase()}";` +
    `position:fixed;left:0;right:0;bottom:0;z-index:2147483647;` +
    `background:${colour.light};color:#111;text-align:center;` +
    `font:700 15px/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:.08em;` +
    `padding:12px 12px calc(12px + env(safe-area-inset-bottom));` +
    `box-shadow:0 -1px 0 rgba(0,0,0,.2)}\n`
  const sheets = listFiles(CLIENT_DIR).filter((rel) =>
    rel.endsWith(".css"),
  )
  if (sheets.length === 0) {
    throw new Error(
      "ota-lab: the build emitted no stylesheet to stamp — the badge would never appear",
    )
  }
  for (const rel of sheets) {
    const file = path.join(CLIENT_DIR, rel)
    writeFileSync(file, readFileSync(file, "utf8") + rule)
  }
}

/** A colour the bench can name — the palette's, or whatever the config holds. */
type Colour = { name: string; light: string; dark: string }

function currentColour(): Colour {
  const source = readFileSync(CONFIG, "utf8")
  const match = source.match(/themeColor:\s*\{\s*light:\s*"([^"]+)"/)
  return (
    PALETTE.find((c) => c.light === match?.[1]) ?? {
      //A colour the bench did not set, which is worth showing rather than
      //normalising away: it means someone edited the config between runs.
      name: "custom",
      light: match?.[1] ?? "?",
      dark: "?",
    }
  )
}

function setColour(next: Colour): void {
  const source = readFileSync(CONFIG, "utf8")
  writeFileSync(
    CONFIG,
    source.replace(
      /themeColor:\s*\{[^}]*\}/,
      `themeColor: { light: "${next.light}", dark: "${next.dark}" }`,
    ),
  )
}

function nextColour(): Colour {
  const now = currentColour()
  const index = PALETTE.findIndex((c) => c.name === now.name)
  return PALETTE[(index + 1) % PALETTE.length] as Colour
}

// ─── steps ───────────────────────────────────────────────────────────────────

async function buildCapacitor(): Promise<void> {
  run("npx", ["vite", "build"], {
    ...(await otaEnv()),
    ADAPTV_TARGET: "capacitor",
  })
}

/** Build the native app and put it on the simulator — the "from the store" install. */
async function install(): Promise<void> {
  const device = target()
  say("building and installing — this is the app as a user first gets it")
  const env = await otaEnv()
  //`--force` is not belt-and-braces. The build cache keys on the APP's inputs, and
  //adaptv is linked into this playground, so a change to the framework's own source
  //leaves the fingerprint untouched and the previous binary is reinstalled — with a
  //perfectly convincing "✓ ios · 16.1s" above it. Every symptom then lands on the
  //feature you just changed: it looks like the app ignores the channel, because the
  //app on the device genuinely predates the code that would have asked.
  const preview = () =>
    run(
      "npx",
      ["adaptv", "preview", PLATFORM, "--target", device, "--force"],
      env,
    )
  preview()
  //Second pass, and only ever a second pass: the policy below is compiled INTO the
  //binary, and the native project it edits does not exist until the first build has
  //generated it.
  if (permitLocalCleartext()) preview()
  reachChannel(device)
  //The one fact that decides whether anything below can ever work: the binary now
  //on the device trusts THIS key, and only a reinstall can change that.
  say(
    `installed, running ${currentColour().name}, trusting ${keyPrint(
      (await signingPair()).publicKey,
    )}`,
  )
}

/**
 * Make `localhost:41790` mean the host, from inside the device.
 *
 * The iOS simulator shares the host's loopback, so there is nothing to do. An
 * Android emulator does not: `localhost` there is the emulator itself, and the
 * app's update check fails with a connection error the updater swallows on
 * purpose — so the symptom is a launch that asks for nothing and says nothing.
 * Re-applied on every launch because the mapping does not survive a reboot of
 * the emulator, and re-applying costs a process.
 */
function reachChannel(device: string): void {
  if (PLATFORM !== "android") return
  try {
    execFileSync(
      "adb",
      [
        "-s",
        device,
        "reverse",
        `tcp:${CHANNEL_PORT}`,
        `tcp:${CHANNEL_PORT}`,
      ],
      { stdio: "ignore" },
    )
  } catch {
    //the device went away since it was resolved; the launch that follows says so
  }
}

const ANDROID_MAIN = path.join(HERE, ".adaptv/android/app/src/main")
const NETWORK_POLICY = path.join(
  ANDROID_MAIN,
  "res/xml/network_security_config.xml",
)
const POLICY_REF =
  'android:networkSecurityConfig="@xml/network_security_config"'

/**
 * Let the Android app read the bench's channel over plain http.
 *
 * ⚠︎ **Without this the Android leg looks exactly like a broken framework.**
 * Android refuses cleartext http by default, and the refusal happens inside the
 * platform's own network stack: the update check throws before a byte leaves the
 * device, the updater catches it the way it catches being offline, and the launch
 * asks for nothing at all. In the channel log that is indistinguishable from an
 * app that was never wired for updates. It cost an afternoon once; the probe that
 * settled it was one call to the native http plugin over the WebView's debugger,
 * which answered `Cleartext HTTP traffic to localhost not permitted`.
 *
 * Scoped to the two names that mean "the machine this bench runs on", so it can
 * never quietly permit the open internet. A shipped channel is https and needs
 * none of this — the framework now refuses an http origin at build time, and this
 * bench is allowed through by the same rule that allows a loopback address.
 *
 * Written here rather than committed because `.adaptv/` is generated and ignored:
 * a fresh clone has no native project at all, so the bench re-applies the policy
 * whenever the project has been regenerated, and reports having done so.
 */
function permitLocalCleartext(): boolean {
  if (PLATFORM !== "android") return false
  const manifest = path.join(ANDROID_MAIN, "AndroidManifest.xml")
  if (!existsSync(manifest)) return false
  const source = readFileSync(manifest, "utf8")
  if (source.includes(POLICY_REF) && existsSync(NETWORK_POLICY))
    return false

  mkdirSync(path.dirname(NETWORK_POLICY), { recursive: true })
  writeFileSync(
    NETWORK_POLICY,
    [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<network-security-config>",
      '  <domain-config cleartextTrafficPermitted="true">',
      '    <domain includeSubdomains="false">localhost</domain>',
      '    <domain includeSubdomains="false">10.0.2.2</domain>',
      "  </domain-config>",
      "</network-security-config>",
      "",
    ].join("\n"),
  )
  if (!source.includes(POLICY_REF)) {
    writeFileSync(
      manifest,
      source.replace(
        "<application",
        `<application\n        ${POLICY_REF}`,
      ),
    )
  }
  say("android: the app may now read the bench's channel over http")
  return true
}

/** A short, comparable name for a key — enough to spot a rotation at a glance. */
function keyPrint(pem: string): string {
  return `key ${createHash("sha256").update(pem.trim()).digest("hex").slice(0, 8)}`
}

/**
 * The compatibility gate's value, computed by **the framework's own function**.
 *
 * Imported rather than reimplemented on purpose: if the bench computed this
 * itself and drifted by one byte, every published bundle would be refused with
 * `needs-store-release` and the bench would be blaming the app for its own bug.
 */
async function nativeFingerprint(): Promise<string> {
  const [{ computeNativeFingerprint }, config] = await Promise.all([
    import(
      pathToFileURL(
        path.join(ADAPTV_ROOT, "src/ota/native-fingerprint.ts"),
      ).href
    ),
    import(pathToFileURL(CONFIG).href),
  ])
  const app = config.default
  return computeNativeFingerprint(HERE, {
    appId: app.appId,
    plugins: app.plugins,
    adaptvRoot: ADAPTV_ROOT,
  }).fingerprint
}

/**
 * Rebuild with the next colour and push it to the channel.
 *
 * Note what this does NOT touch: the installed app. That separation is the whole
 * point — publishing is a server-side event, and the device only finds out because
 * it asks.
 */
async function publish(): Promise<void> {
  const colour = nextColour()
  say(`switching to ${colour.name} and rebuilding`)
  setColour(colour)
  await buildCapacitor()
  //before the tag is computed: the tag is a content hash of this directory, so
  //stamping after it would publish a hash that describes bytes nobody ships
  await stampBadge(colour)
  const plan = await emitChannel()

  say(
    `published ${plan.buildTag} (${colour.name}, ${kb(plan.bundleBytes)}, signed)`,
  )
  console.log(
    `\n  the channel now offers ${bold(colour.name)}; the installed app still runs the old one.` +
      `\n  → ${bold("relaunch once")} (checks + downloads, nothing visible)` +
      `\n  → ${bold("relaunch again")} — a bar reading ${bold(`OTA · ${colour.name.toUpperCase()}`)} appears` +
      "\n    across the bottom of the app. That bar exists only in the published" +
      "\n    bundle, so seeing it IS the update.\n",
  )
}

/**
 * Publish a bundle built for a native layer this app does not have.
 *
 * The case the default exists for. A release that adds a Capacitor plugin ships
 * its web half the day it is published and its native half whenever review and
 * the user get around to it, so for a while every install is running JS made for
 * an app it is not. adaptv **installs it anyway** — the rest of that release is
 * worth more than the one feature that will be dark — and reports the gap
 * instead: `useStoreRelease()` for the install, `useNativePlugin()` per feature.
 * → `docs/design/ota.md §5.6`
 *
 * ## Why the fingerprint is overridden rather than genuinely moved
 *
 * The honest way to produce this state is to add a plugin package and publish
 * without rebuilding the binary. That drags the app's `package.json` and its
 * lockfile into a bench step, and a half-applied one leaves the playground
 * broken in a way that looks like the framework. What actually reaches the
 * device is a manifest whose fingerprint does not match its binary — which is
 * exactly what this writes, byte for byte.
 *
 * The half that is NOT simulated is the interesting half, and it is already
 * real: the lab's OTA page asks about `Nfc`, a plugin no build here has ever
 * contained. Its answer comes from `Capacitor.PluginHeaders`, straight from the
 * binary, and it is the same answer a genuinely missing plugin would give.
 */
async function skew(): Promise<void> {
  const colour = nextColour()
  say(`building ${colour.name} as if a native plugin had been added`)
  setColour(colour)
  await buildCapacitor()
  await stampBadge(colour)

  const real = await nativeFingerprint()
  //A fingerprint is an opaque hash of the native surface, so "a different native
  //surface" is any other hash. Derived from the real one so it is stable across
  //re-publishes: a fingerprint that changed every run would make the device look
  //like it was falling behind again and again.
  const moved = createHash("sha256")
    .update(`${real}:one-more-native-plugin`)
    .digest("hex")
  const plan = await emitChannel(moved)

  say(`published ${plan.buildTag} — ${bold("built for a newer app")}`)
  console.log(
    `\n  manifest fingerprint  ${moved.slice(0, 16)}…` +
      `\n  this binary's         ${real.slice(0, 16)}…\n` +
      `\n  → ${bold("relaunch")} twice. The bar reading ${bold(`OTA · ${colour.name.toUpperCase()}`)} must appear:` +
      "\n    the bundle installs, because withholding it would withhold every other" +
      "\n    fix in that release too." +
      `\n  → open ${bold("Testing → OTA & native capability")}. It must now read ${bold("behind")},` +
      "\n    with today's date, while the capability rows are unchanged — the binary" +
      "\n    did not move, only the channel did." +
      `\n  → run ${bold("publish")} once and it goes back to up to date: a manifest that` +
      "\n    asks for the native layer this app has clears the state, and only that does.\n" +
      "\n  ⚠︎ What this step CANNOT stage is the bundle's own fingerprint moving with it." +
      "\n    Only the manifest is overridden here; the bundle is built from this" +
      "\n    machine's real node_modules, so it still carries the true one. The device" +
      "\n    reads the binary's fingerprint from the ledger rather than from the running" +
      "\n    bundle precisely because those two DO diverge once a plugin is genuinely" +
      "\n    added — and that divergence is covered in `src/ota/updater.test.ts`.\n",
  )
}

/**
 * Publish a bundle that **cannot boot** — the only way to see the safety net.
 *
 * Rollback is the one part of the loop with no benign failure mode: if the
 * watchdog does not fire, one bad deploy is a bricked app on every device that
 * took it, and there is no second chance to notice, because a bundle that cannot
 * boot cannot update itself out of that state either.
 *
 * The poison is a top-level `throw` appended to the entry module, which is as
 * close to a real "this build is broken" as a bench can get: the document loads,
 * the prerendered HTML paints, and the app never mounts. Nothing calls
 * `settleLaunch`, so nothing calls the plugin's `ready()`, so `readyTimeout`
 * expires and the plugin reverts. → `docs/design/ota.md §5.4b`
 */
async function poison(): Promise<void> {
  const colour = nextColour()
  say(`building ${colour.name} and then breaking it on purpose`)
  setColour(colour)
  await buildCapacitor()
  await stampBadge(colour)
  const entry = await poisonEntry()
  const plan = await emitChannel()

  say(`published ${plan.buildTag} — ${bold("this bundle cannot boot")}`)
  console.log(
    `\n  broke ${entry}\n` +
      `\n  → ${bold("relaunch")}   downloads and stages it. Still the old bundle, still fine.` +
      `\n  → ${bold("watchdog")}   boots it. Expect the ${bold("boot error screen")} at ~${BOOT_GRACE_S}s,` +
      `\n                then the plugin reverting at ~${READY_TIMEOUT_S}s. The step waits for both.` +
      `\n  → ${bold("relaunch")}   back on a bundle that works, and the channel's poisoned` +
      "\n                tag is now blocked on this device, so it is never taken again.\n",
  )
}

/**
 * Break the entry module, after the tag would have been computed from it.
 *
 * Rewriting the file rather than renaming it is what makes this work: the
 * filename is content-hashed and `index.html` already references it, so every
 * reference stays intact while what runs changes. Same reason {@link stampBadge}
 * writes into the stylesheet.
 *
 * ⚠︎ **Prepended, and appending is a silent no-op.** The first attempt put the
 * `throw` at the end of the entry, which does abort — after the module body has
 * already mounted the app. The bundle then boots, pings, and is marked
 * known-good, so the bench published a "broken" build that was perfectly fine and
 * reported the watchdog as not firing. A throw in the body's first statement runs
 * once the static imports have, and before anything mounts.
 */
async function poisonEntry(): Promise<string> {
  const CLIENT_DIR = await clientDir()
  const html = readFileSync(path.join(CLIENT_DIR, "index.html"), "utf8")
  const entry = html.match(
    /<script[^>]+type="module"[^>]+src="\/([^"]+\.js)"/,
  )?.[1]
  if (!entry) {
    throw new Error(
      "ota-lab: no module entry in index.html — nothing to poison, and a bundle that boots would prove nothing here",
    )
  }
  const file = path.join(CLIENT_DIR, entry)
  writeFileSync(
    file,
    `throw new Error("ota-lab: poisoned bundle")\n${readFileSync(file, "utf8")}`,
  )
  return entry
}

/**
 * Refuse to publish a bundle that does not trust the key this bench signs with.
 *
 * 🔴 The one invariant here with **no symptom**. Every signature verifies, the
 * channel is well-formed, the device fetches each manifest — and refuses all of
 * them, silently, because a manifest whose signature does not check out is not an
 * error the updater can distinguish from being offline (by design: a bundle under
 * attack must not be able to report on its own verification). The channel log
 * shows a healthy 200 for the manifest and no request for the zip, which is also
 * what a device with nothing to do looks like.
 *
 * It caught a real one: the native build's output moved and the bench went on
 * zipping a stale directory, so every published bundle carried a previous
 * session's key. See {@link clientDir}. That failure is closed at the root now,
 * but this is the assertion that would have named it in one line.
 */
function assertTrustsBenchKey(
  clientDirPath: string,
  publicKey: string,
): void {
  const baked = listFiles(clientDirPath)
    .filter((rel) => rel.endsWith(".js"))
    .map(
      (rel) =>
        readFileSync(path.join(clientDirPath, rel), "utf8").match(
          /publicKey:\s*[`"'](-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----)/,
        )?.[1],
    )
    .find(Boolean)
  if (!baked) {
    throw new Error(
      "ota-lab: the built bundle bakes no OTA public key — it was built without ADAPTV_OTA_PUBLIC_KEY, and every update it publishes would be refused",
    )
  }
  const normalise = (pem: string) => pem.replace(/\\n/g, "\n").trim()
  if (normalise(baked) !== normalise(publicKey)) {
    throw new Error(
      `ota-lab: the built bundle trusts ${keyPrint(normalise(baked))}, but this channel signs with ${keyPrint(publicKey)}.\n` +
        "  Every update would be fetched and then refused in silence. Run `fresh` to reinstall against the current pair.",
    )
  }
}

/**
 * Write the channel from whatever the native build just produced.
 *
 * `fingerprint` overrides the native fingerprint stamped into the manifest, and
 * only `skew` passes it — see there for why publishing a fingerprint the build
 * did not produce is the honest way to stage that case.
 */
async function emitChannel(fingerprint?: string): Promise<{
  buildTag: string
  bundleBytes: number
}> {
  const {
    buildBundleArchive,
    computeBuildTag,
    decideChannelEmission,
    writeChannel,
  } = await otaEmit()

  //Everything from here down is the framework's, unchanged: the tag, the archive,
  //the manifest's shape, and both signatures. The bench's only contribution is
  //where the files land and which key signs them.
  const CLIENT_DIR = await clientDir()
  const pair = await signingPair()
  assertTrustsBenchKey(CLIENT_DIR, pair.publicKey)
  mkdirSync(CHANNEL_DIR, { recursive: true })
  const plan = decideChannelEmission({
    buildTag: computeBuildTag(CLIENT_DIR),
    //Read from disk rather than fetched, so `publish` works with no server up.
    //It answers one question — is this the build already advertised? — and a
    //re-publish of unchanged bytes must keep its original `createdAt` or the
    //replay defence reads a redeploy as a release.
    deployed: readChannelManifest(),
    now: Date.now(),
  })
  const written = writeChannel({
    //The channel dir stands in for `dist/client`: `writeChannel` places the
    //manifest and the zip under `.well-known/adaptv/ota/` inside whatever it is
    //given, which is exactly how they ride the ordinary web deploy.
    clientDir: CHANNEL_DIR,
    origin: OTA_ORIGIN,
    plan,
    archive: buildBundleArchive(CLIENT_DIR),
    nativeFingerprint: fingerprint ?? (await nativeFingerprint()),
    privateKey: pair.privateKey,
  })
  return { buildTag: plan.buildTag, bundleBytes: written.bundleBytes }
}

/** Where `writeChannel` puts the manifest, under whatever site root it is given. */
const MANIFEST_FILE = path.join(
  CHANNEL_DIR,
  ".well-known/adaptv/ota/manifest.json",
)

function readChannelManifest(): {
  buildTag: string
  url: string
  sha256: string
  nativeFingerprint: string
  createdAt: number
  signature?: string
  manifestSignature?: string
} | null {
  if (!existsSync(MANIFEST_FILE)) return null
  try {
    return JSON.parse(readFileSync(MANIFEST_FILE, "utf8"))
  } catch {
    return null
  }
}

/**
 * Serve the channel. Hand-rolled rather than `npx serve`, for three reasons that
 * all bit: no download on first run, no surprise when offline, and CORS answered
 * exactly the way a real static host does NOT — see below.
 */
function serve(): void {
  mkdirSync(CHANNEL_DIR, { recursive: true })
  createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? "/").split("?")[0] ?? "")
    //Served at its REAL path, `.well-known/adaptv/ota/…` and all. Flattening to
    //the basename would work and would hide the one thing this address is for:
    //the channel is a few files inside an ordinary site, at a path the deploy
    //already serves, and a host that mishandles a dot-directory is a real failure
    //this bench should be able to reproduce.
    const file = path.join(CHANNEL_DIR, path.normalize(name))
    if (!file.startsWith(CHANNEL_DIR)) {
      res.writeHead(403).end("no")
      return
    }
    //Handed out freely here, and that is a deliberate divergence from production:
    //a real static host sends no `Access-Control-Allow-Origin`, which is exactly
    //why the updater reads the manifest through the native HTTP plugin instead of
    //`fetch` (`docs/design/ota.md §5.4`). If this bench were strict about it, a broken
    //updater would look broken for the wrong reason; if you ever want to REPRODUCE
    //that failure, delete this header.
    res.setHeader("Access-Control-Allow-Origin", "*")
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("no")
      console.log(`  404  ${name}`)
      return
    }
    res.writeHead(200, {
      "Content-Type": name.endsWith(".json")
        ? "application/json"
        : "application/zip",
      "Cache-Control": "no-store",
    })
    res.end(readFileSync(file))
    console.log(`  200  ${name}`)
  }).listen(CHANNEL_PORT, () => {
    say(`serving the channel on http://localhost:${CHANNEL_PORT}`)
    console.log(
      "  leave this running in its own shell — every request is logged below,\n" +
        "  so a launch that never asks for the manifest is visible immediately.\n" +
        `  Android also needs:  adb -s <serial> reverse tcp:${CHANNEL_PORT} tcp:${CHANNEL_PORT}\n`,
    )
  })
}

/** Sleep, synchronously, because every step in this bench is synchronous. */
function pause(seconds: number): void {
  execFileSync("sleep", [String(seconds)])
}

/**
 * Cold-restart. Cold specifically: the bundle pointer is only read at launch.
 *
 * ⚠︎ The two waits are load-bearing, and doing this by hand without them is a
 * reliable way to conclude the update is broken when it worked.
 *
 * **Before the kill** the app is sent to the background, because `setNextBundle`
 * writes the pointer to `UserDefaults` and iOS only flushes that when the app
 * *suspends*. `simctl terminate` is a kill: fire it right after the download and
 * the bundle is on disk, unpacked and complete, with nothing pointing at it.
 *
 * **After the launch** it waits, because the check runs once the app tree mounts.
 * Relaunch again too quickly and the download never started, so the run that was
 * supposed to be "checks + downloads" did neither.
 */
function relaunch(settleSeconds = 7): void {
  const device = target()
  const id = bundleId(device)
  reachChannel(device)
  suspend(device)
  pause(2)
  kill(device, id)
  //NOT silenced — a launch that fails here (wrong id, app not installed) must be
  //loud, because a silent one is indistinguishable from an update that did not
  //land
  launch(device, id)
  say(`relaunched ${id} on ${device} — letting it check the channel`)
  pause(settleSeconds)
  console.log("  ready for the next step\n")
}

/** Background the app, so pending preference writes are flushed before the kill. */
function suspend(device: string): void {
  try {
    if (PLATFORM === "android") {
      execFileSync(
        "adb",
        ["-s", device, "shell", "input", "keyevent", "KEYCODE_HOME"],
        { stdio: "ignore" },
      )
      return
    }
    //any other app will do — this is a "go to the home screen" simctl can do
    execFileSync("xcrun", [
      "simctl",
      "launch",
      device,
      "com.apple.Preferences",
    ])
  } catch {
    //nothing running to suspend
  }
}

function kill(device: string, id: string): void {
  try {
    execFileSync(
      PLATFORM === "android" ? "adb" : "xcrun",
      PLATFORM === "android"
        ? ["-s", device, "shell", "am", "force-stop", id]
        : ["simctl", "terminate", device, id],
      { stdio: "ignore" },
    )
  } catch {
    //not running is a perfectly good starting state
  }
}

function launch(device: string, id: string): void {
  if (PLATFORM === "android") {
    execFileSync(
      "adb",
      [
        "-s",
        device,
        "shell",
        "monkey",
        "-p",
        id,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
      ],
      { stdio: "inherit" },
    )
    return
  }
  execFileSync("xcrun", ["simctl", "launch", device, id], {
    stdio: "inherit",
  })
}

/**
 * Two clocks that both have to be outlasted before a rollback can be judged.
 *
 * They start at different moments — `BOOT_GRACE_MS` at `DOMContentLoaded`, the
 * plugin's `readyTimeout` in its constructor — so the margin below is on top of
 * the later one, not the sum. Cutting the wait short is how a working watchdog
 * gets reported as broken: the app is terminated mid-countdown and the revert it
 * was about to perform never happens.
 */
const BOOT_GRACE_S = 8
const READY_TIMEOUT_S = 15

/** Cold-restart and stay up long enough for the watchdog to have its say. */
function watchdog(): void {
  relaunch(READY_TIMEOUT_S + 10)
}

/** What the device could get, what it runs, and what is not wired yet. */
async function status(): Promise<void> {
  const colour = currentColour()
  console.log(
    `\n  source colour       ${bold(colour.name)} (${colour.light})`,
  )

  const manifest = readChannelManifest()
  const archive = manifest
    ? path.join(CHANNEL_DIR, new URL(manifest.url).pathname.slice(1))
    : null
  if (!manifest || !archive || !existsSync(archive)) {
    console.log("  channel             empty — run `publish`")
  } else {
    console.log(
      `  channel offers      ${bold(manifest.buildTag)} (${kb(statSync(archive).size)})`,
    )
  }

  //Everything above is the bench. These are the things that make the DEVICE
  //participate: without them the app looks like it never asked for an update.
  //Note what is NOT among them — the native fingerprint. It is reported below as
  //a state, not checked here as a failure, because a channel built against a
  //native layer this binary does not have is now installed anyway (`install` is
  //the default for `otaOnNativeSkew`) and is exactly what `skew` produces.
  const expected = await nativeFingerprint()
  const trusted = existsSync(PUBLIC_KEY)
    ? readFileSync(PUBLIC_KEY, "utf8")
    : null
  const wiring = [
    {
      label: "update plugin installed",
      ok: existsSync(
        path.join(
          ADAPTV_ROOT,
          "node_modules/@capawesome/capacitor-live-update",
        ),
      ),
      fix: "pnpm add it at the adaptv root",
    },
    {
      label: "app asks for updates",
      ok: grepsFor("startOtaUpdates", path.join(ADAPTV_ROOT, "src/hooks")),
      fix: "wire useOtaUpdates into the shell",
    },
    //The two signatures, checked here the way the two halves of the device check
    //them. Both are refused in SILENCE on a real run — the native one inside the
    //plugin, the JS one inside `decideUpdate` — so a bench that did not check
    //them would report a perfectly published channel and a device that ignores it.
    {
      label: "zip signature verifies",
      ok:
        !manifest ||
        !archive ||
        !trusted ||
        verifiesArchive(manifest, archive, trusted),
      fix: "republish — the key that signed this is not the one installed",
    },
    {
      label: "manifest signature verifies",
      ok:
        !manifest ||
        !trusted ||
        (await verifiesManifest(manifest, trusted)),
      fix: "republish — the key that signed this is not the one installed",
    },
  ]
  console.log("")
  for (const step of wiring) {
    console.log(
      `  ${step.ok ? "✓" : "✗"} ${step.label.padEnd(29)}${step.ok ? "" : `→ ${step.fix}`}`,
    )
  }
  console.log(`\n  native fingerprint  ${expected.slice(0, 16)}…`)
  //The skew, stated rather than judged. Both readings are legitimate benches:
  //one is the ordinary loop, the other is what a consumer's app lives through
  //between a native change and the store release that carries it.
  if (manifest) {
    console.log(
      manifest.nativeFingerprint === expected
        ? "  channel native      same as this binary — the ordinary loop"
        : `  channel native      ${bold("ahead of this binary")} (${manifest.nativeFingerprint.slice(0, 16)}…)\n` +
            "                      installs anyway; useStoreRelease() reports behind",
    )
  }
  console.log(
    `  signing pair        ${trusted ? keyPrint(trusted) : "none yet — `fresh` makes one"}`,
  )
  if (wiring.some((s) => !s.ok)) {
    console.log(
      `\n  ${bold("the loop cannot run yet")} — fix the ✗ above; until then a\n` +
        "  relaunch will show no change no matter how correct the channel is.\n",
    )
  } else console.log("")
}

/**
 * The native half's check, run here: RSA over the SHA-256 of the zip's bytes.
 *
 * Reproduced with `createVerify` rather than imported, because there is nothing to
 * import — the real one is Swift and Kotlin inside the plugin, and this is the
 * closest a Node process gets to it. `sha256` is checked alongside it: the plugin
 * refuses on either, and telling them apart matters, since one means a corrupt
 * download and the other means the wrong key.
 */
function verifiesArchive(
  manifest: { sha256: string; signature?: string },
  archive: string,
  publicKey: string,
): boolean {
  const bytes = readFileSync(archive)
  if (createHash("sha256").update(bytes).digest("hex") !== manifest.sha256)
    return false
  if (!manifest.signature) return false
  return createVerify("sha256")
    .update(bytes)
    .verify(publicKey, manifest.signature, "base64")
}

/** The JS half's check — the framework's own, so the canonical form cannot drift. */
async function verifiesManifest(
  manifest: Record<string, unknown>,
  publicKey: string,
): Promise<boolean> {
  const { verifyManifestSignature } = await import(
    pathToFileURL(path.join(ADAPTV_ROOT, "src/ota/manifest-signing.ts"))
      .href
  )
  return await verifyManifestSignature({ manifest, publicKey })
}

function reset(): void {
  rmSync(CHANNEL_DIR, { recursive: true, force: true })
  say("channel wiped — the next `publish` starts a fresh lineage")
}

/**
 * Back to "never installed": wipe the channel, the app, and everything the
 * device remembers. **Start every run of the bench here.**
 *
 * Uninstalling is the part that is easy to skip and expensive to skip. A bundle
 * downloaded by an earlier run survives a reinstall — same bundle id, same data
 * container — so the app keeps booting that older bundle, complete with whatever
 * was wrong with the code it was built from. The binary you just installed never
 * runs, and the bench reports a failure that is two builds old.
 *
 * It is also the only step allowed to rotate the signing key, because it is the
 * only step that reinstalls: the public half is baked into the binary, so a new
 * pair without a new install is a channel the device refuses on every publish.
 */
async function fresh(): Promise<void> {
  //before anything is wiped: a run that cannot name its device must not have
  //already rotated the key the installed app trusts
  const device = target()
  reset()
  rmSync(KEY_DIR, { recursive: true, force: true })
  const { publicKey } = await newSigningPair()
  say(`new signing pair — ${keyPrint(publicKey)}`)
  for (const id of [APP_ID, `${APP_ID}.dev`]) {
    try {
      execFileSync(
        PLATFORM === "android" ? "adb" : "xcrun",
        PLATFORM === "android"
          ? ["-s", device, "uninstall", id]
          : ["simctl", "uninstall", device, id],
        { stdio: "ignore" },
      )
    } catch {
      //not installed is exactly the state being asked for
    }
  }
  say("app uninstalled — nothing on the device remembers a bundle now")
  await install()
}

// ─── plumbing ────────────────────────────────────────────────────────────────

function grepsFor(needle: string, dir: string): boolean {
  if (!existsSync(dir)) return false
  return listFiles(dir).some(
    (rel) =>
      /\.(ts|tsx)$/.test(rel) &&
      readFileSync(path.join(dir, rel), "utf8").includes(needle),
  )
}

function run(
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
): void {
  execFileSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  })
}

const bold = (s: string) => `[1m${s}[0m`
const say = (s: string) => console.log(`\n[36m·[0m ${s}`)
const kb = (n: number) => `${Math.round(n / 1024)} kB`

const STEPS = {
  serve,
  fresh,
  publish,
  relaunch,
  watchdog,
  poison,
  skew,
  status,
  install,
  reset,
} as const
type Step = keyof typeof STEPS

const MENU: [Step, string][] = [
  ["serve", "serve the channel (leave running in another shell)"],
  ["fresh", "START HERE — wipe channel + app, then build and install"],
  ["publish", "rebuild in the next colour and push it to the channel"],
  ["relaunch", "cold-restart the app — the only way the pointer is read"],
  ["poison", "publish a bundle that CANNOT boot, to see the net work"],
  ["watchdog", "cold-restart and wait out the revert (after `poison`)"],
  ["skew", "publish a bundle built for a native layer this app lacks"],
  ["status", "what the channel offers, and what is still not wired"],
  ["install", "reinstall only (leaves the device's downloaded bundles)"],
  ["reset", "wipe the channel only"],
]

async function interactive(): Promise<void> {
  console.log(
    `\n  ${bold("ota lab")} — watch an update land, across three launches\n`,
  )
  await status()
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    for (;;) {
      for (const [index, [name, help]] of MENU.entries())
        console.log(`  ${index + 1}  ${name.padEnd(10)}${help}`)
      const answer = (await rl.question("\n  > ")).trim()
      if (!answer || answer === "q") return
      const picked =
        MENU[Number(answer) - 1]?.[0] ??
        (answer in STEPS ? (answer as Step) : null)
      if (!picked) {
        console.log("  ?\n")
        continue
      }
      try {
        await STEPS[picked]()
      } catch (error) {
        console.error(
          `\n  failed: ${error instanceof Error ? error.message : String(error)}\n`,
        )
      }
    }
  } finally {
    rl.close()
  }
}

const arg = process.argv[2] as Step | undefined
if (arg && arg in STEPS) await STEPS[arg]()
else if (arg) {
  console.error(
    `unknown step "${arg}". One of: ${Object.keys(STEPS).join(", ")}`,
  )
  process.exit(1)
} else await interactive()
