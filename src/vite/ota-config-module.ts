import type { Plugin } from "vite"
import type { AdaptvAppConfig } from "#adaptv/config/app-config.ts"
import { computeNativeFingerprint } from "#adaptv/ota/native-fingerprint.ts"
import type { NativeSkewPolicy } from "#adaptv/ota/policy.ts"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { requireAppConfig } from "#adaptv/vite/adaptv-context.ts"

/**
 * `virtual:adaptv/ota-config` — what an installed app needs to find its own
 * updates, resolved at build time. → `LIFECYCLE.md §5.2`
 *
 * ## Why a virtual module and not root-route config
 *
 * OTA is a lifecycle concern, not a routing one, and the two values here are
 * *build outputs* rather than things the consumer writes: the origin is derived,
 * and the fingerprint is computed by reading `node_modules`. The root route is a
 * pure `config → string` function with no filesystem, and it should stay that way.
 *
 * ## Why the fingerprint is baked in and the build tag is not
 *
 * The fingerprint is an **input** to the build — the set of native plugins — so it
 * is knowable before the bundle exists and stable across rebuilds of the same
 * source. The build tag is a content hash of the bundle's own output, so it cannot
 * live inside the bundle without altering the thing it describes. The running app
 * asks the update plugin which bundle it booted instead. → `src/ota/updater.ts`
 */

export const OTA_CONFIG_VIRTUAL_ID = "virtual:adaptv/ota-config"
const RESOLVED_OTA_CONFIG_ID = `\0${OTA_CONFIG_VIRTUAL_ID}`

/**
 * Where the channel lives under the app's origin.
 *
 * `.well-known` because the channel rides the ORDINARY web deploy — the same
 * artifact that serves the PWA also serves every native install its updates, so
 * there is no second pipeline to keep in step. → `LIFECYCLE.md §5.2`
 */
export const OTA_CHANNEL_PATH = "/.well-known/adaptv/ota"
export const OTA_MANIFEST_PATH = `${OTA_CHANNEL_PATH}/manifest.json`

export type OtaBuildConfig = {
  manifestUrl: string
  nativeFingerprint: string
  /** `otaOnNativeSkew`, defaulted here so the runtime never has to. */
  nativeSkew: NativeSkewPolicy
  requireSignature: boolean
  /** SPKI PEM — `null` only when the build has explicitly opted out of signing. */
  publicKey: string | null
}

/**
 * The origin installed apps will ask for updates, or `null` for "OTA is off".
 *
 * `ADAPTV_OTA_ORIGIN` wins so a local channel can be pointed at without editing —
 * and therefore without risking committing — the permanent, store-baked origin.
 */
export function resolveOtaOrigin(config: AdaptvAppConfig): string | null {
  const origin = process.env.ADAPTV_OTA_ORIGIN ?? config.origin
  return origin ? origin.replace(/\/+$/, "") : null
}

/**
 * The public key this build trusts, or `null` when it declares none.
 *
 * 🔴 One resolver, two consumers that must never disagree. The JS half checks
 * `manifestSignature` against this; the native half checks the zip's `signature`
 * against the copy in the Capacitor config. Resolve them separately and a build
 * can end up trusting one key in JS and another in native, which reads on a
 * device as "the update downloads and is then silently refused".
 *
 * `ADAPTV_OTA_PUBLIC_KEY` is the local-verification override, and it exists for
 * the same reason {@link resolveOtaOrigin} has one, only more sharply: the
 * committed key's private half lives in a secret store by design, so verifying
 * a signed channel locally would otherwise mean either holding the production
 * key on a laptop or editing the committed config. Both are worse than a
 * variable. It is gated on `ADAPTV_OTA_ORIGIN` so it can only take effect on a
 * build already pointed at a hand-specified channel — swapping the trust anchor
 * of a production build takes two deliberate variables, never one.
 */
export function resolveOtaPublicKey(
  config: AdaptvAppConfig,
): string | null {
  const override = process.env.ADAPTV_OTA_PUBLIC_KEY?.trim()
  if (override && process.env.ADAPTV_OTA_ORIGIN) return override
  return config.otaPublicKey ?? null
}

/**
 * Hosts that mean "this machine", where plain http is a local test rather than a
 * shipped channel. `10.0.2.2` is on the list because an Android emulator reaches
 * the laptop it runs on under that address and no other.
 */
const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "[::1]",
  "::1",
  "10.0.2.2",
])

/**
 * Refuse an update origin the installed app could never read.
 *
 * 🔴 **Plain http is not a slow channel, it is no channel at all.** Both mobile
 * platforms block cleartext by default, so the update check fails inside the
 * network stack, before a single byte leaves the device. The updater treats a
 * failed check as "offline", which is the right call for a real network and
 * exactly wrong here: nothing is logged, nothing is retried differently, and the
 * app goes on running the bundle it shipped with for ever. The observable symptom
 * is an update system that installs nothing and reports no error, which is the
 * most expensive shape a bug can have.
 *
 * Caught at build time because it cannot be caught later: it is invisible in the
 * bundle, invisible on the web (where the origin is read by the browser, not by
 * the platform's http stack), and only shows on an installed device.
 *
 * Local addresses are allowed through, because that is a bench pointing an app at
 * a channel on the same machine. Reaching one of those from a device still needs
 * the platform's own dev exception, which is the bench's business, not the
 * framework's.
 */
export function assertReachableOtaOrigin(origin: string): void {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new Error(
      `adaptv: the update origin is not a valid URL: ${origin}\n` +
        "  Set `origin` (or ADAPTV_OTA_ORIGIN) to a full origin, scheme included.",
    )
  }
  if (url.protocol === "https:") return
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return
  throw new Error(
    `adaptv: the update origin must be https, and this build points at ${origin}\n` +
      "  iOS and Android both block plain http, so the update check would fail\n" +
      "  before reaching the network. That failure is indistinguishable from being\n" +
      "  offline, so every install would silently stay on its store version.\n" +
      "  Serve the channel over https, or use a local address for a bench.",
  )
}

/**
 * Whether unsigned manifests may be installed.
 *
 * Signing is mandatory by default: an update channel is a remote-code-execution
 * channel into every installed app, and without a signature anyone who can write
 * to the CDN owns it. → `LIFECYCLE.md §5.4d`
 *
 * The opt-out is an env var rather than a config field **because a config field
 * gets committed** — one person disables it to test locally, it lands on main, and
 * every future release ships with verification off and nothing to show for it. It
 * is further tied to `ADAPTV_OTA_ORIGIN`, so it can only take effect on a build
 * already pointed at a hand-specified channel: a production build cannot reach
 * this state by setting one variable.
 */
export function allowsUnsignedManifests(): boolean {
  return (
    process.env.ADAPTV_OTA_ALLOW_UNSIGNED === "1" &&
    Boolean(process.env.ADAPTV_OTA_ORIGIN)
  )
}

/** The virtual module's source. Pure — the caller does the filesystem work. */
export function renderOtaConfigModule(
  config: OtaBuildConfig | null,
): string {
  return [
    "/* Generated by @arrzdev/adaptv — served as a VIRTUAL module, not written to disk. */",
    `export const otaConfig = ${config ? JSON.stringify(config, null, 2) : "null"}`,
    "",
  ].join("\n")
}

/** Serve `virtual:adaptv/ota-config`. */
export function adaptvOtaConfigPlugin(context: AdaptvContext): Plugin {
  return {
    name: "adaptv:ota-config",
    resolveId(id) {
      if (id === OTA_CONFIG_VIRTUAL_ID) return RESOLVED_OTA_CONFIG_ID
      return null
    },
    load(id) {
      if (id !== RESOLVED_OTA_CONFIG_ID) return null
      return renderOtaConfigModule(
        resolveOtaBuildConfig(context.appRoot, requireAppConfig(context)),
      )
    },
  }
}

/**
 * Resolve the whole block, or `null` when OTA is off.
 *
 * Off means genuinely off — no manifest URL reaches the bundle, so the app never
 * asks anything. An app with no `appId` has no native build to update at all.
 */
export function resolveOtaBuildConfig(
  appRoot: string,
  config: AdaptvAppConfig,
): OtaBuildConfig | null {
  const origin = resolveOtaOrigin(config)
  if (!origin || !config.appId) return null

  //Before anything is computed from it: an unreachable origin makes every other
  //value here correct and useless.
  assertReachableOtaOrigin(origin)

  const { fingerprint } = computeNativeFingerprint(appRoot, {
    appId: config.appId,
    plugins: config.plugins,
  })

  return {
    manifestUrl: `${origin}${OTA_MANIFEST_PATH}`,
    nativeFingerprint: fingerprint,
    //Defaulted at build time, so the shipped bundle carries a literal answer and
    //no runtime has to reproduce the default. → `LIFECYCLE.md §5.6`
    nativeSkew: config.otaOnNativeSkew ?? "install",
    requireSignature: !allowsUnsignedManifests(),
    //Shipped in the bundle as well as in the native config. It is public, and the
    //runtime needs its own copy to check the manifest's signature — the half the
    //plugin's native check does not cover. → `#adaptv/ota/manifest-signing`
    publicKey: resolveOtaPublicKey(config),
  }
}
