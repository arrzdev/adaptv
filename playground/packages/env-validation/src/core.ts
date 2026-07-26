import { z } from "zod"

export type EnvValidationItem = {
  name: string
  required: boolean
  valid: boolean
  valuePassed: boolean
  error?: string
}

function isFieldOptional(
  schema: z.ZodObject<z.ZodRawShape>,
  key: string,
): boolean {
  const field = schema.shape[key]
  if (!field) return true
  if (
    typeof (field as unknown as { isOptional?: () => boolean })
      .isOptional === "function"
  ) {
    return (field as unknown as { isOptional: () => boolean }).isOptional()
  }
  return field instanceof z.ZodOptional || field instanceof z.ZodDefault
}

export function validateEnv<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
  raw: Record<string, unknown>,
): EnvValidationItem[] {
  const items: EnvValidationItem[] = []
  const parsed = schema.safeParse(raw)

  const zodErrors: Record<string, string[]> = {}
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const pathKey = String(issue.path[0])
      zodErrors[pathKey] = zodErrors[pathKey] || []
      zodErrors[pathKey].push(issue.message)
    }
  }

  for (const key of Object.keys(schema.shape)) {
    const required = !isFieldOptional(schema, key)
    const present = key in raw && raw[key] !== undefined && raw[key] !== ""
    const errors = zodErrors[key] || []

    if (required && !present) {
      items.push({
        name: key,
        required: true,
        valid: false,
        valuePassed: false,
        error: "Missing required variable",
      })
      continue
    }

    if (!required && !present) {
      items.push({
        name: key,
        required: false,
        valid: true,
        valuePassed: false,
      })
      continue
    }

    if (errors.length > 0) {
      items.push({
        name: key,
        required,
        valid: !required,
        valuePassed: true,
        error: errors.join("; "),
      })
      continue
    }

    items.push({ name: key, required, valid: true, valuePassed: true })
  }

  return items
}

export function isEnvValid(items: EnvValidationItem[]): boolean {
  return items.every((i) => !i.required || i.valid)
}

/** CLI table: ✅ value present and passes schema, otherwise ❌ */
export function envCheckValidEmoji(item: EnvValidationItem): "✅" | "❌" {
  return item.valuePassed && !item.error ? "✅" : "❌"
}
