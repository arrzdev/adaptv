import { useEffect, useState } from "react"
import type { OrientationLock } from "#adaptv/config/types"
import tryCatch from "#adaptv/utils/try-catch"

function normalizeOrientation(value: unknown): OrientationLock {
  if (typeof value !== "string") return "any"
  if (value.startsWith("portrait")) return "portrait"
  if (value.startsWith("landscape")) return "landscape"
  return "any"
}

/**
 * Reads the web app manifest `orientation` field at runtime — the single source
 * of truth for the orientation lock. Android enforces it natively; this lets the
 * iOS guard mirror the same value. Manifest values outside `portrait*` /
 * `landscape*` (e.g. `any`, `natural`) collapse to `"any"` (no guard). Returns
 * `"any"` until the manifest loads or when the fetch fails (offline first load),
 * so the guard degrades to off rather than blocking the app.
 */
export function useManifestOrientation(
  manifestPath: string,
): OrientationLock {
  const [orientation, setOrientation] = useState<OrientationLock>("any")

  useEffect(() => {
    let isActive = true

    async function load() {
      const [manifest, error] = await tryCatch(() =>
        fetch(manifestPath).then(
          (res) => res.json() as Promise<{ orientation?: unknown }>,
        ),
      )
      if (!isActive || error) return
      setOrientation(normalizeOrientation(manifest.orientation))
    }

    void load()
    return () => {
      isActive = false
    }
  }, [manifestPath])

  return orientation
}
