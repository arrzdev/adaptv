//---- Bearer token store -------------------------------------------
//the session bearer token, kept in its own import-free module so the typed RPC
//client (data/backend-client.ts) can read it for auto auth-header injection
//without forming a cycle with the auth client (which depends on backend-client).
//sessions are BEARER tokens (no cross-origin cookie pain for the PWA): the
//server returns the token in `set-auth-token` on every auth response, we stash
//it here, and send it back as `Authorization: Bearer …` on every request.

const TOKEN_KEY = "chopchop.bearer"

function readToken(): string {
  if (typeof localStorage === "undefined") return ""
  return localStorage.getItem(TOKEN_KEY) ?? ""
}

//the current session bearer token (or "" for a guest) — the RPC client attaches
//it so user-scoped requests authenticate
export function getBearerToken(): string {
  return readToken()
}

export function writeToken(token: string | null): void {
  if (typeof localStorage === "undefined") return
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}
