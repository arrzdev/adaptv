import { runDev } from "@repo/dev/run-dev"
import { PORTS } from "@/ports"

runDev({
  ports: Object.values(PORTS),
  // fatal env gate: the same `check:env` the `pnpm dev` prefix used to run,
  // folded in so `tsx scripts/dev.ts` alone validates env before starting.
  preflight: [{ command: "tsx", args: ["env/check-env.ts"] }],
  command: "wrangler",
  args: [
    "dev",
    // wrangler only auto-loads a root-level `.env`; ours lives in the `env/`
    // subdir (same file check:env validates and deploy uploads as secrets), so
    // point it there explicitly or the worker starts with no runtime env.
    "--env-file",
    "env/.env",
    "--port",
    String(PORTS.appPort),
    "--inspector-port",
    String(PORTS.supervisorPort),
  ],
})
