import { env } from "@/env/registry"
import { isPrivateOrigin } from "@/utils/is-private-origin"

//whether the network policy runs in "dev" mode — CORS reflecting and better-auth
//trusting localhost/LAN origins — derived from the configured frontend origin,
//NOT a build/process flag. a deployed worker can't reliably read NODE_ENV/CI at
//module load (secrets arrive per-request, and process.env.CI is simply absent in
//production, which made the old `process.env.CI !== "true"` evaluate to dev), so
//"is this a dev environment" is decided by the one signal that IS present and
//trustworthy: is the configured FRONTEND_URL itself a localhost/LAN origin. a
//production https frontend yields false, so private origins are never reflected
//or trusted in prod.
export function allowsPrivateOrigins(): boolean {
  return isPrivateOrigin(env.FRONTEND_URL)
}
