import { cors } from "hono/cors"
import { env } from "@/env/registry"
import { allowsPrivateOrigins } from "@/http/network-policy"
import { isPrivateOrigin } from "@/utils/is-private-origin"

const PREFLIGHT_MAX_AGE_SECONDS = 86_400 // 24h — browser skips OPTIONS until cache expires

//explicit allowlist now that the api is credentialed (bearer tokens + the
//better-auth session-cookie cache). reflects the configured frontend origin,
//plus localhost/LAN origins in dev so a phone on the network can sign in. the
//client reads its session token from the exposed `set-auth-token` header.
export function corsPlugin() {
  return cors({
    origin: (origin) => {
      const allowed = new URL(env.FRONTEND_URL).origin
      if (!origin) return allowed
      if (origin === allowed) return origin
      if (allowsPrivateOrigins() && isPrivateOrigin(origin)) return origin
      return null
    },
    credentials: true,
    allowMethods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    exposeHeaders: ["set-auth-token"],
    maxAge: PREFLIGHT_MAX_AGE_SECONDS,
  })
}
