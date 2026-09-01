import type { AppPorts } from "@repo/dev/ports"

// appPort = dev server; supervisorPort = the reserved second port of this app's
// block (the e2e harness moves the inspector there — see playwright.config.ts).
export const PORTS = {
  appPort: 41730,
  supervisorPort: 41740,
} satisfies AppPorts
