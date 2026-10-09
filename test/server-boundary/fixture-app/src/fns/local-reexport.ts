import { defineAction } from "../lib/server"

export const viaLocalReexport = defineAction().handler(
  async () => "local-reexport",
)
