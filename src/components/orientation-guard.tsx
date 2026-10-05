import type { ComponentType } from "react"
import type {
  OrientationGuardProps,
  OrientationLock,
} from "#adaptv/config/types"
import { useManifestOrientation } from "#adaptv/hooks/use-manifest-orientation"
import { useMediaQuery } from "#adaptv/hooks/use-media-query"

// Coarse-pointer only, so a desktop window in a landscape aspect ratio is never
// guarded — only touch devices physically rotated away from the lock.
const MISMATCH_QUERY: Record<Exclude<OrientationLock, "any">, string> = {
  portrait: "(orientation: landscape) and (pointer: coarse)",
  landscape: "(orientation: portrait) and (pointer: coarse)",
}

export type OrientationGuardHostProps = {
  /** Path to the web app manifest; its `orientation` field drives the lock. */
  manifestPath: string
  /** App-supplied overlay; falls back to the built-in rotate prompt. */
  component?: ComponentType<OrientationGuardProps>
}

/**
 * Renders a full-screen guard when a touch device is rotated away from the
 * orientation declared in the web app manifest — the single source of truth.
 * iOS ignores the manifest lock and has no working JS orientation lock, so this
 * runtime guard is the only reliable hold there; Android enforces the manifest
 * natively. The only related config is an optional `orientationGuardComponent`.
 */
export function OrientationGuard({
  manifestPath,
  component,
}: OrientationGuardHostProps) {
  const orientation = useManifestOrientation(manifestPath)
  const query = orientation === "any" ? null : MISMATCH_QUERY[orientation]
  const isMismatched = useMediaQuery(query)

  if (orientation === "any" || !isMismatched) return null

  const Guard = component ?? DefaultOrientationGuard
  return <Guard orientation={orientation} />
}

//The look is styles/orientation-guard.css, keyed on `data-adaptv` / `data-part`: an
//app that wants another one replaces the whole guard (`orientationGuardComponent`).
//`data-adaptv="orientation-guard"` stays on the root alone; each sub-part carries its
//own `orientation-guard-<part>` scope, so the root's selector matches one element.
function DefaultOrientationGuard({ orientation }: OrientationGuardProps) {
  return (
    <div data-adaptv="orientation-guard" data-part="root" role="alert">
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        data-adaptv="orientation-guard-icon"
        data-part="icon"
      >
        <title>Rotate device</title>
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
      </svg>
      <p data-adaptv="orientation-guard-message" data-part="message">
        Rotate your device to {orientation} to continue.
      </p>
    </div>
  )
}
