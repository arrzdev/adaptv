import { Logger } from "@repo/shared/logging"
import tryCatch from "@repo/shared/try-catch"
import { createAuthClient } from "better-auth/react"
import { getBearerToken, writeToken } from "@/data/auth/token"
import { backendBaseUrl } from "@/data/backend-client"

const log = new Logger("auth")

//---- Auth client --------------------------------------------------
//better-auth's SDK is the auth data layer: it drives sign-in/up/out + the oauth
//flow against the mounted handler and exposes a reactive session. sessions are
//BEARER tokens (no cross-origin cookie pain for the PWA): the server returns the
//token in `set-auth-token` on every auth response, we stash it (data/auth/token.ts),
//and send it back as `Authorization: Bearer …` on every request.

export const authClient = createAuthClient({
  //full path — the handler is mounted at the api's /api/v1/auth basePath
  baseURL: `${backendBaseUrl}/api/v1/auth`,
  fetchOptions: {
    auth: { type: "Bearer", token: getBearerToken },
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get("set-auth-token")
      if (token) writeToken(token)
    },
  },
})

export type AuthSessionUser = {
  id: string
  email: string
  name: string
}

//raw reactive session snapshot straight from better-auth. `isPending` here is
//better-auth's own flag: true on the first resolve, and flipped back to true on
//every background revalidation while there's no cached user (a signed-out
//guest). the AuthProvider flattens this into a stale-while-revalidate value that
//only reflects the FIRST resolve — app code reads the provider's `useAuth()`,
//not this primitive.
export function useSessionState() {
  const { data, isPending } = authClient.useSession()
  return {
    user: data?.user ?? null,
    isAuthenticated: Boolean(data?.user),
    isPending,
  }
}

//clear the local bearer token alongside the server sign-out. the local token
//is dropped regardless of whether the network call succeeds, so sign-out always
//takes effect on this device.
export async function signOut(): Promise<void> {
  const [, signOutError] = await tryCatch(() => authClient.signOut())
  //the local token is dropped regardless (sign-out always takes effect on this
  //device), but a failed server revocation means the session may still be valid
  //server-side — surface it rather than swallowing it
  if (signOutError) log.warn("server sign-out failed", signOutError)
  writeToken(null)
}
