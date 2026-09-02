declare module "virtual:adaptv/ota-config" {
  /** `null` when OTA is off — no `origin`, or no native `appId`. */
  export const otaConfig: {
    manifestUrl: string
    nativeFingerprint: string
    /** What to do with a bundle built for a different set of native plugins. */
    nativeSkew: "install" | "refuse"
    requireSignature: boolean
    /** SPKI PEM. `null` only in an explicitly unsigned local build. */
    publicKey: string | null
    /** Foreground poll interval in ms, or `0` for launch + resume only. */
    pollIntervalMs: number
  } | null
}
