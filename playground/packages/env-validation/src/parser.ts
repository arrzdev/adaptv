import { access, readFile } from "node:fs/promises"
import { join } from "node:path"

function parseEnvContent(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1).replace(/\\"/g, '"')
    out[key] = value
  }
  return out
}

export async function parseEnvFile(
  path: string,
): Promise<Record<string, string>> {
  try {
    const raw = await readFile(path, "utf-8")
    return parseEnvContent(raw)
  } catch {
    return {}
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function resolveEnvFile(appDir: string): Promise<{
  record: Record<string, string>
  source: ".env" | null
}> {
  const envPath = join(appDir, ".env")
  if (await pathExists(envPath)) {
    return { record: await parseEnvFile(envPath), source: ".env" }
  }
  return { record: {}, source: null }
}
