import type { Context, MiddlewareHandler, Next } from "hono"
import { getDb } from "@/database/client"
import type { Env } from "@/env/registry"
import { CustomError } from "@/http/errors"
import type { SessionUser } from "@/services/auth.service"
import { AuthService } from "@/services/auth.service"

//variables added by requireAuth() — `user` is set only on routes that mount
//it; guest/public routes never read it.
export type AuthedVariables = {
  user: SessionUser
}

//---- requireAuth --------------------------------------------------
//gate a route on a signed-in user. resolves the session from the request
//(bearer token / cookie), sets `c.get("user")` for handlers, and throws
//`unauthorized` for guests — so guest clients simply never reach user-scoped
//data (sync), staying fully local.

export function requireAuth(): MiddlewareHandler<{
  Bindings: Env
  Variables: AuthedVariables
}> {
  return async (
    c: Context<{ Bindings: Env; Variables: AuthedVariables }>,
    next: Next,
  ) => {
    const user = await new AuthService(getDb(c.env.DB)).getSessionUser(
      c.req.raw.headers,
    )
    if (!user) throw new CustomError("unauthorized")
    c.set("user", user)
    await next()
  }
}
