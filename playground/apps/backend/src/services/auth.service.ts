import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import tryCatch from "@repo/shared/try-catch"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { bearer } from "better-auth/plugins"
import { authSchema } from "@/database/auth.schema"
import type { Db } from "@/database/client"
import { profiles } from "@/database/schema"
import { env } from "@/env/registry"
import { allowsPrivateOrigins } from "@/http/network-policy"
import { isPrivateOrigin } from "@/utils/is-private-origin"

export const PROVIDER_NAMES = ["github", "google"] as const
export type SocialProviderName = (typeof PROVIDER_NAMES)[number]

export type SessionUser = {
  id: string
  email: string | null
  name: string | null
}

//---- Workers password hashing -------------------------------------
//better-auth's default scrypt (@noble/hashes, pure JS) exceeds the Cloudflare
//Workers CPU budget on cold sign-up/sign-in (better-auth#8860). node:crypto's
//native scrypt (via nodejs_compat) is fast and uses the SAME params + `salt:key`
//hex format, so hashes stay compatible with the default. passed by reference to
//better-auth below, so they're module functions, not class methods.

const SCRYPT_N = 16384
const SCRYPT_R = 16
const SCRYPT_P = 1
const SCRYPT_DKLEN = 64

function scryptDerived(password: string, saltHex: string): Buffer {
  return scryptSync(password.normalize("NFKC"), saltHex, SCRYPT_DKLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  })
}

async function hashPasswordForWorkers(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex")
  const key = scryptDerived(password, salt)
  return `${salt}:${key.toString("hex")}`
}

async function verifyPasswordForWorkers(input: {
  hash: string
  password: string
}): Promise<boolean> {
  const [salt, keyHex] = input.hash.split(":")
  if (!salt || !keyHex) return false
  const derived = scryptDerived(input.password, salt)
  const expected = Buffer.from(keyHex, "hex")
  if (expected.length !== derived.length) return false
  return timingSafeEqual(expected, derived)
}

//---- better-auth instance -----------------------------------------
//one instance per worker isolate (re-creating per request blows cpu on cold
//sign-in), so it's cached by the db handle it was built with — and getDb()
//hands back a stable handle per binding, making this effectively per-isolate.
//bearer-token sessions (the SPA stores the token, no cross-origin cookie pain).
//add an oauth provider in TWO places that stay in sync: the `socialProviders`
//block here and PROVIDER_NAMES above — each lights up only when its env creds
//are present.

const authCache = new Map<Db, ReturnType<typeof createAuth>>()

function createAuth(db: Db) {
  return betterAuth({
    appName: "chopchop",
    secret: env.BETTER_AUTH_SECRET,
    //must be the full api url so oauth callback urls match provider config
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/v1/auth",
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
    }),
    trustedOrigins: allowsPrivateOrigins()
      ? async (request) => {
          //createAuthContext probes getTrustedOrigins() with no request at
          //init; skip until real HTTP traffic carries an origin
          if (request === undefined) return []
          const origin = request.headers.get("origin")
          if (origin && isPrivateOrigin(origin)) return [origin]
          return [new URL(env.FRONTEND_URL).origin]
        }
      : [new URL(env.FRONTEND_URL).origin],
    emailAndPassword: {
      enabled: true,
      //node:crypto scrypt — the default pure-JS scrypt blows the workers budget
      password: {
        hash: hashPasswordForWorkers,
        verify: verifyPasswordForWorkers,
      },
    },
    socialProviders: {
      ...(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? {
            github: {
              clientId: env.GITHUB_CLIENT_ID,
              clientSecret: env.GITHUB_CLIENT_SECRET,
            },
          }
        : {}),
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    //the SPA reads the token from the `set-auth-token` response header and
    //sends it back as `Authorization: Bearer …`
    plugins: [bearer()],
    session: {
      //signed cookie cache so repeated getSession reads skip a db round-trip
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (created: { id: string }) => {
            //mirror every new auth user into our own profile row — app-editable
            //fields (username, …) live there, never on better-auth's `user`
            const now = new Date()
            await db
              .insert(profiles)
              .values({
                userId: created.id,
                username: null,
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing()
          },
        },
      },
    },
  })
}

//test-only: drop cached instances so a fresh env/secret takes effect
export function resetAuthForTests(): void {
  authCache.clear()
}

//---- Auth service -------------------------------------------------
//thin domain wrapper over better-auth: sign-in/up/out + the oauth flow are
//handled by better-auth's mounted handler + its client SDK, so all WE own is
//(1) forwarding requests to that handler, (2) resolving the current user for
//our own user-scoped routes, and (3) telling the client which social providers
//are live. constructed with the db like every other service.

export class AuthService {
  constructor(private db: Db) {}

  private auth() {
    const cached = authCache.get(this.db)
    if (cached) return cached
    const instance = createAuth(this.db)
    authCache.set(this.db, instance)
    return instance
  }

  //forward a request straight to better-auth's mounted handler (every method
  //under its basePath: sign-in/up/out, oauth start + callback, get-session).
  handler(request: Request): Promise<Response> {
    return this.auth().handler(request)
  }

  //resolve the signed-in user from request headers (bearer token / cookie), or
  //null for a guest. a resolution failure is treated as "guest" (fail-closed):
  //routes that require auth then return unauthorized.
  async getSessionUser(headers: Headers): Promise<SessionUser | null> {
    const [session, sessionError] = await tryCatch(() =>
      this.auth().api.getSession({ headers }),
    )
    if (sessionError || !session?.user?.id) return null
    return {
      id: session.user.id,
      email: session.user.email ?? null,
      name: session.user.name ?? null,
    }
  }

  //providers advertised to the client — only those with both creds configured
  listSocialProviders(): SocialProviderName[] {
    return PROVIDER_NAMES.filter((name) => {
      if (name === "github")
        return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)
      return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    })
  }
}
