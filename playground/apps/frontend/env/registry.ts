import { createEnvRegistry } from "@repo/env-validation/registry-factory"
import type { z } from "zod"
import { envSchema } from "@/env/schema"

function autoHydrateVite(
  schema: z.ZodObject<z.ZodRawShape>,
): Record<string, unknown> {
  if (typeof import.meta.env === "undefined") return {}
  const out: Record<string, unknown> = {}

  for (const key of Object.keys(schema.shape)) {
    if (key in import.meta.env) {
      out[key] = import.meta.env[key as keyof ImportMetaEnv]
    }
  }
  return out
}

export const envRegistry = createEnvRegistry({
  schema: envSchema,
  initialEnv: autoHydrateVite(envSchema),
  internals: {
    DEV: import.meta.env.DEV,
  },
})

export const env = envRegistry.env

export type Env = (typeof envRegistry)["env"]
