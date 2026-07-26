import type { z } from "zod"

export type RegistryInternals = {
  DEV: boolean
}

export type EnvFromRegistry<
  TSchema extends z.ZodObject<z.ZodRawShape>,
  TBindings = undefined,
> = (undefined extends TBindings
  ? z.infer<TSchema>
  : TBindings & z.infer<TSchema>) & {
  readonly internals: Readonly<RegistryInternals>
}

export type EnvRegistry<TEnv> = {
  setEnv(raw: Record<string, unknown>): void
  readonly env: TEnv
}

export function createEnvRegistry<
  TSchema extends z.ZodObject<z.ZodRawShape>,
  TBindings = undefined,
>(options: {
  schema: TSchema
  initialEnv?: Record<string, unknown>
  internals: RegistryInternals
}): EnvRegistry<EnvFromRegistry<TSchema, TBindings>> {
  const store: Record<string, unknown> = { ...options.initialEnv }
  let initialized = options.initialEnv !== undefined

  const envProxy = new Proxy({} as EnvFromRegistry<TSchema, TBindings>, {
    get(_target, prop) {
      if (typeof prop !== "string") return undefined
      if (prop === "internals") return Object.freeze(options.internals)

      if (!initialized) {
        throw new Error(
          "envRegistry not initialized. Call setEnv() at your entry point.",
        )
      }

      return store[prop]
    },
  })

  return {
    setEnv(raw: Record<string, unknown>) {
      Object.assign(store, raw)
      initialized = true
    },
    get env() {
      return envProxy
    },
  }
}
