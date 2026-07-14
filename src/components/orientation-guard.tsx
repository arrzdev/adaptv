import type { ComponentType } from "react"
import type {
  OrientationGuardProps,
  OrientationLock,
} from "#nativ/config/types"
import { useManifestOrientation } from "#nativ/hooks/use-manifest-orientation"
import { useMediaQuery } from "#nativ/hooks/use-media-query"

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

function DefaultOrientationGuard({ orientation }: OrientationGuardProps) {
  return (
    <div
      role="alert"
      className="fixed inset-0 z-[110] flex flex-col items-center justify-center gap-y-6 bg-background px-safe-offset-6 py-safe-offset-8 text-center text-foreground"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-14 text-primary"
      >
        <title>Rotate device</title>
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <path d="M11 18h2" />
      </svg>
      <p className="max-w-xs text-balance text-base font-medium text-muted">
        Rotate your device to {orientation} to continue.
      </p>
    </div>
  )
}
