import { spawnSync } from "node:child_process"

const TERM_POLL_MS = 100
const TERM_TIMEOUT_MS = 2000

function sleepMs(ms: number): void {
  spawnSync("sleep", [String(ms / 1000)], { stdio: "ignore" })
}

function listPidsByPort(port: number): number[] {
  // LISTEN only — without it, lsof includes clients (e.g. Chrome tabs on localhost:port).
  const output = spawnSync(
    "lsof",
    ["-ti", `tcp:${port}`, "-sTCP:LISTEN"],
    {
      encoding: "utf-8",
    },
  )
  if (output.status !== 0 || !output.stdout.trim()) return []
  return [
    ...new Set(
      output.stdout
        .trim()
        .split("\n")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ]
}

function signalPid(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(pid, signal)
    return true
  } catch {
    return false
  }
}

function clearPort(port: number): void {
  if (listPidsByPort(port).length === 0) return

  const termDeadline = Date.now() + TERM_TIMEOUT_MS
  while (Date.now() < termDeadline) {
    const pids = listPidsByPort(port)
    if (pids.length === 0) {
      console.log(`✓ cleared port ${port}`)
      return
    }
    for (const pid of pids) signalPid(pid, "SIGTERM")
    sleepMs(TERM_POLL_MS)
  }

  const stubborn = listPidsByPort(port)
  if (stubborn.length === 0) {
    console.log(`✓ cleared port ${port}`)
    return
  }

  for (const pid of stubborn) signalPid(pid, "SIGKILL")
  sleepMs(TERM_POLL_MS * 2)

  if (listPidsByPort(port).length === 0) {
    console.log(`✓ cleared port ${port}`)
    return
  }

  console.warn(
    `⚠ port ${port} still in use — stop the old dev server or kill the listener manually`,
  )
}

export function clearPorts(ports: number[]): void {
  const uniquePorts = [...new Set(ports)]
  for (const port of uniquePorts) clearPort(port)
}
