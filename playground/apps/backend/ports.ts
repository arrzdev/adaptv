import type { AppPorts } from "@repo/dev/ports"

// appPort = dev server; supervisorPort = wrangler/cloudflare inspector.
export const PORTS = {
  appPort: 41830,
  supervisorPort: 41840,
} satisfies AppPorts
