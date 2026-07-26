import { PORTS as BACKEND_PORTS } from "@repo/backend/ports"
import { z } from "zod"

// A LOCAL backend URL must name the port this repo's backend actually binds.
//
// This exists because the two drifted for real. `ports.ts` moved to a new block while
// `env/.env` — git-ignored, so it outlives the checkout it was written for — kept the
// old one. Nothing failed loudly: the app just talked to a port nothing was listening on,
// which reads exactly like "the backend is down", or worse, like offline-first working.
//
// Scoped to localhost / LAN on purpose: a deployed API is an https host with no port, and
// this must never fail a production build. See apps/backend/ports.ts.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)$/

const localPortMatches = (raw: string) => {
  const url = new URL(raw)
  if (!LOCAL_HOST.test(url.hostname)) return true
  return url.port === String(BACKEND_PORTS.appPort)
}

export const envSchema = z.object({
  VITE_BACKEND_URL: z
    .url()
    .refine(
      localPortMatches,
      `a local VITE_BACKEND_URL must use port ${BACKEND_PORTS.appPort} — the port apps/backend/ports.ts binds`,
    ),
})
