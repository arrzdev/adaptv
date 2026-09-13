import type { AppPorts } from "@repo/dev/ports"

// appPort = dev server; supervisorPort = the reserved second port of this app's
// block, freed by `runDev` with the first (nothing listens on it any more).
export const PORTS = {
  appPort: 41730,
  supervisorPort: 41740,
} satisfies AppPorts
