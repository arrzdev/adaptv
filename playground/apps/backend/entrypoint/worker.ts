import type { CloudflareBindings } from "@/env/registry"
import { envRegistry } from "@/env/registry"
import { api } from "@/http/api"

export default {
  async fetch(
    request: Request,
    env: CloudflareBindings & Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<Response> {
    envRegistry.setEnv(env)
    return await api.fetch(request, env, ctx)
  },
}
