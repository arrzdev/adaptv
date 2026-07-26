import { z } from "zod"

export type CloudflareBindings = {
  DB: D1Database
}

//runtime env: `wrangler dev` loads it from `env/.env` (--env-file); deploy
//uploads the same file as Worker secrets. validated by check:env and read at
//runtime via the env registry proxy.
export const envSchema = z.object({
  //32+ char random secret signing sessions/tokens
  BETTER_AUTH_SECRET: z.string().min(16),
  //full public URL of THIS api (better-auth baseURL; oauth callback origin)
  BETTER_AUTH_URL: z.url(),
  //the web app's origin — CORS allowlist + oauth post-login redirect target
  FRONTEND_URL: z.url(),
  //oauth providers are opt-in: a provider is only offered when BOTH its id
  //and secret are set. add a new provider = add its two vars here + a block
  //in services/auth.service.ts.
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
})
