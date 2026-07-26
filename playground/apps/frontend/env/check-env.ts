import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runEnvCheck } from "@repo/env-validation/cli-runner"
import { envSchema } from "@/env/schema"

const currentDir = dirname(fileURLToPath(import.meta.url))

await runEnvCheck({
  schema: envSchema,
  appDir: join(currentDir, ".."),
})
