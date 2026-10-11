import { createServerFn } from "adaptv/server-fn"

export const viaAdaptvSubpath = createServerFn().handler(
  async () => "adaptv-subpath",
)
