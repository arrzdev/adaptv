import { appendFileSync } from "node:fs"
import { join } from "node:path"
import type { z } from "zod"
import {
  envCheckValidEmoji,
  isEnvValid,
  validateEnv,
} from "#env-validation/src/core"
import { parseEnvFile } from "#env-validation/src/parser"

export type RunEnvCheckOptions = {
  schema: z.ZodObject<z.ZodRawShape>
  appDir: string
}

export async function runEnvCheck({
  schema,
  appDir,
}: RunEnvCheckOptions): Promise<void> {
  const envDir = join(appDir, "env")

  //validate the committed contract against the local `env/.env` (the same file
  //`wrangler dev --env-file` loads and deploy uploads as secrets). `.env` only.
  const localEnv = await parseEnvFile(join(envDir, ".env"))
  const combinedRaw = { ...localEnv, ...process.env }

  const reports = validateEnv(schema, combinedRaw)
  const isValid = isEnvValid(reports)

  if (reports.length > 0) {
    console.table(
      reports.map((r) => ({
        Variable: r.name,
        Type: r.required ? "Required" : "Optional",
        Valid: envCheckValidEmoji(r),
        ...(r.valuePassed && r.error ? { Message: r.error } : {}),
      })),
    )
  }

  if (reports.length > 0 && process.env.GITHUB_STEP_SUMMARY) {
    let tableMarkdown = "### 🔐 Environment Check\n\n"
    tableMarkdown += "| (index) | Variable | Type | Valid |\n"
    tableMarkdown += "| --- | --- | --- | --- |\n"

    for (let i = 0; i < reports.length; i++) {
      const r = reports[i]
      tableMarkdown += `| ${i} | \`${r.name}\` | ${r.required ? "Required" : "Optional"} | ${envCheckValidEmoji(r)} |\n`
    }
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${tableMarkdown}\n`)
  }

  if (!isValid) process.exit(1)
}
