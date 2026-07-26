import { env } from "cloudflare:workers"

export async function clearSync() {
  await env.DB.prepare("DELETE FROM documents").run()
  await env.DB.prepare("DELETE FROM sync_counters").run()
}
