import { newEndpoint } from "@repo/shared/http"
import { getDb } from "@/database/client"
import type { Env } from "@/env/registry"
import { ok } from "@/http/envelope"
import { rateLimit } from "@/http/middlewares/rate-limit"
import { AuthService } from "@/services/auth.service"

//better-auth owns every method under its basePath (/api/v1/auth/*): sign-in,
//sign-up, sign-out, the oauth start + callback, get-session. forward the raw
//request straight to its handler — its client SDK on the frontend drives them.
export const authHandlerRoutes = newEndpoint<Env>()
  .use("*", rateLimit("auth"))
  .on(["GET", "POST"], "/*", (c) =>
    new AuthService(getDb(c.env.DB)).handler(c.req.raw),
  )

//discovery endpoint so the client renders exactly the oauth buttons that are
//configured — a provider missing its creds is never advertised
export const socialProviderRoutes = newEndpoint<Env>().get("/", (c) =>
  ok(c, {
    providers: new AuthService(getDb(c.env.DB)).listSocialProviders(),
  }),
)
