import { spawn, spawnSync } from "node:child_process"
import { clearPorts } from "#dev/src/clear-ports"

type ProcessSpec = {
  command: string
  args: string[]
  cwd?: string
  shell?: boolean
}

// A step run to completion BEFORE the dev server starts (e.g. provision a
// secret, then validate env). `onNonZero`: "fatal" (default) runs teardown then
// exits; "warn" prints `warnMessage` and continues — for a dev convenience that
// isn't required for the server to run.
type PreflightStep = ProcessSpec & {
  onNonZero?: "fatal" | "warn"
  warnMessage?: string
}

type RunDevOptions = ProcessSpec & {
  ports: number[]
  // ordered steps run (spawnSync) before the dev server.
  preflight?: PreflightStep[]
  // processes spawned alongside the dev server and torn down with it (e.g. a
  // local cron simulator).
  sideProcesses?: ProcessSpec[]
  // extra cleanup on teardown (e.g. kill a detached listener by pid file).
  onTeardown?: () => void
}

// Frees the given ports (kill-and-takeover), runs any preflight steps, then the
// dev server plus optional side processes — forwarding signals so Ctrl-C / turbo
// shutdown reach every child cleanly and `onTeardown` always runs exactly once.
// With no preflight/sideProcesses/onTeardown/cwd/shell it behaves exactly like a
// bare single-process launcher.
export function runDev(options: RunDevOptions): void {
  const {
    ports,
    command,
    args,
    cwd,
    shell,
    preflight = [],
    sideProcesses = [],
    onTeardown,
  } = options

  clearPorts(ports)

  for (const step of preflight) {
    const result = spawnSync(step.command, step.args, {
      stdio: "inherit",
      cwd: step.cwd,
      shell: step.shell,
    })
    if ((result.status ?? 1) !== 0) {
      if (step.onNonZero === "warn") {
        if (step.warnMessage) console.warn(step.warnMessage)
        continue
      }
      onTeardown?.()
      process.exit(result.status ?? 1)
    }
  }

  const server = spawn(command, args, { stdio: "inherit", cwd, shell })
  // Side processes get the terminal's OUTPUT but not its input: `stdin: "ignore"`.
  // Sharing stdin means racing for it — wrangler and vite both read keys for their own
  // hotkeys, so whichever grabs a keystroke first wins and the FOREGROUND command's keys
  // (adaptv's `r` reload / `b` rebuild) silently stop working. Only `command` is meant to
  // be interactive; a background service that captured the keyboard would be a bug.
  const sides = sideProcesses.map((side) =>
    spawn(side.command, side.args, {
      stdio: ["ignore", "inherit", "inherit"],
      cwd: side.cwd,
      shell: side.shell,
    }),
  )

  let tornDown = false
  const teardown = (signal: NodeJS.Signals = "SIGTERM"): void => {
    if (tornDown) return
    tornDown = true
    onTeardown?.()
    for (const child of [server, ...sides]) child.kill(signal)
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => teardown(signal))
  }

  for (const child of [server, ...sides]) {
    child.on("error", (error) => {
      console.error(error)
      teardown()
      process.exit(1)
    })
  }

  server.on("exit", (code, signal) => {
    teardown()
    process.exit(signal ? 1 : (code ?? 0))
  })
}
