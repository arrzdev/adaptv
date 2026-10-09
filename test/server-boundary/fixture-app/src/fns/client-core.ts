import { createServerFn } from "@tanstack/start-client-core"

export const viaClientCore = createServerFn().handler(
  async () => "client-core",
)
