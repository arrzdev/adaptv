import { runDev } from "@repo/dev/run-dev"
import { PORTS } from "@/ports"

// `tsx scripts/dev.ts [ios|android|all]` — this package's dev server.
//
// Every target goes through the adaptv CLI, web included. `adaptv dev web` is the same Vite
// dev server, started by the framework that owns the build; running `vite` directly would be
// a second, subtly different way to start the app (adaptv also stamps the generated files and
// resolves the toolchain env) and the two would drift.
//
// Only the app is started here — the API is its own turbo task, so each gets its own pane and
// neither writes over the other. (An earlier version started the backend as a side process,
// which meant its startup banner landed in the middle of adaptv's redrawn status line.)
//
// adaptv's dev command is interactive: it redraws a live status line and reads raw keys
// (`r` reload, `b` rebuild, ctrl-c stop). Those work under turbo's TUI via
// `"interactive": true` on the task — select the pane and press `i`, `Ctrl-z` to leave.
// This needs turbo >= 2.10 (2.9.x accepted the flag but never delivered the keystrokes).
const NATIVE_TARGETS = ["ios", "android", "all"] as const
type NativeTarget = (typeof NATIVE_TARGETS)[number]

const arg = process.argv[2]
if (arg && !NATIVE_TARGETS.includes(arg as NativeTarget)) {
  console.error(
    `Unknown dev target "${arg}". Use one of: ${NATIVE_TARGETS.join(", ")} — or omit it for web.`,
  )
  process.exit(1)
}
const target = arg as NativeTarget | undefined

runDev({
  ports: Object.values(PORTS),
  // fatal env gate: the same `check:env` the `pnpm dev` prefix used to run,
  // folded in so `tsx scripts/dev.ts` alone validates env before starting.
  preflight: [{ command: "tsx", args: ["env/check-env.ts"] }],
  // `--latest` reuses the device picked last time so a pane never blocks on the interactive
  // picker. Run `pnpm exec adaptv dev <target>` directly to choose a different device.
  command: "adaptv",
  args: target ? ["dev", target, "--latest"] : ["dev", "web"],
})
