import { networkInterfaces } from "node:os"

//first non-internal IPv4 — the address a device on the same wifi can reach
export function getLanIp(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    if (!addrs) continue
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address
    }
  }
  return "127.0.0.1"
}
