import { env } from "cloudflare:workers"

export async function clearTodos() {
  await env.DB.prepare("DELETE FROM todos").run()
}
