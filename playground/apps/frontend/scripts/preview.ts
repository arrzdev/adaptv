import { runDev } from "@repo/dev/run-dev"
import { PORTS } from "@/ports"

// `tsx scripts/preview.ts [ios|android|all]` — this package's PREVIEW run.
//
// The sibling of `scripts/dev.ts`, for the other half of the loop: `preview` is the real
// static build, installed and launched, with no live reload. It's what catches the things
// only a production bundle shows — a missing precache entry, a service worker serving a
// stale shell, an asset path that only worked because Vite was serving it.
//
// Same shape as dev on purpose: ports freed first (web preview binds the app port, and a
// dev server from the last run is usually still holding it), the same fatal env gate, and
// the backend running beside it as its own turbo task — a preview build talks to the real
// API, so previewing without it would only prove the app renders offline.
//
// `--latest` for the same reason dev uses it: a turbo pane must never block on the
// interactive device picker. Run `pnpm exec adaptv preview <target>` to pick another device.
const NATIVE_TARGETS = ["ios", "android", "all"] as const
type NativeTarget = (typeof NATIVE_TARGETS)[number]

const arg = process.argv[2]
if (arg && !NATIVE_TARGETS.includes(arg as NativeTarget)) {
  console.error(
    `Unknown preview target "${arg}". Use one of: ${NATIVE_TARGETS.join(", ")} — or omit it for web.`,
  )
  process.exit(1)
}
const target = arg as NativeTarget | undefined

runDev({
  ports: Object.values(PORTS),
  preflight: [{ command: "tsx", args: ["env/check-env.ts"] }],
  command: "adaptv",
  args: target ? ["preview", target, "--latest"] : ["preview", "web"],
})
