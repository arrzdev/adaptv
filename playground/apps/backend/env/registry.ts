import { createEnvRegistry } from "@repo/env-validation/registry-factory"
import type { CloudflareBindings } from "@/env/schema"
import { envSchema } from "@/env/schema"

export const envRegistry = createEnvRegistry<
  typeof envSchema,
  CloudflareBindings
>({
  schema: envSchema,
  internals: {
    //network dev-mode (CORS/trusted-origin reflection of localhost/LAN) is NOT
    //read from here — a worker can't reliably detect prod at module load, and
    //the old `process.env.CI !== "true"` evaluated to `true` in production.
    //consumers derive it from the validated frontend origin instead — see
    //src/http/network-policy.ts. kept false so any future reader fails closed.
    DEV: false,
  },
})

export const env = envRegistry.env

export type Env = (typeof envRegistry)["env"]

export type { CloudflareBindings } from "@/env/schema"
export { envSchema } from "@/env/schema"
