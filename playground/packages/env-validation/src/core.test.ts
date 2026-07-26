import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  envCheckValidEmoji,
  isEnvValid,
  validateEnv,
} from "#env-validation/src/core"

describe("validateEnv", () => {
  it("flags a missing required var as invalid and blocking", () => {
    const [item] = validateEnv(z.object({ API_KEY: z.string() }), {})
    expect(item).toMatchObject({
      name: "API_KEY",
      required: true,
      valid: false,
      valuePassed: false,
      error: "Missing required variable",
    })
    expect(isEnvValid([item])).toBe(false)
    expect(envCheckValidEmoji(item)).toBe("❌")
  })

  it("accepts a required var that is present and schema-valid", () => {
    const [item] = validateEnv(z.object({ API_KEY: z.string() }), {
      API_KEY: "secret",
    })
    expect(item).toMatchObject({
      name: "API_KEY",
      required: true,
      valid: true,
      valuePassed: true,
    })
    expect(item.error).toBeUndefined()
    expect(isEnvValid([item])).toBe(true)
    expect(envCheckValidEmoji(item)).toBe("✅")
  })

  it("rejects a required var present but failing its schema", () => {
    const [item] = validateEnv(z.object({ API_KEY: z.string().min(8) }), {
      API_KEY: "short",
    })
    expect(item.required).toBe(true)
    expect(item.valid).toBe(false)
    expect(item.valuePassed).toBe(true)
    expect(item.error).toBeTruthy()
    expect(isEnvValid([item])).toBe(false)
    expect(envCheckValidEmoji(item)).toBe("❌")
  })

  it("treats an empty string as absent for a required var", () => {
    const [item] = validateEnv(z.object({ API_KEY: z.string() }), {
      API_KEY: "",
    })
    expect(item).toMatchObject({
      required: true,
      valid: false,
      valuePassed: false,
      error: "Missing required variable",
    })
  })

  it("passes an absent optional var without a value", () => {
    const [item] = validateEnv(
      z.object({ FEATURE_FLAG: z.string().optional() }),
      {},
    )
    expect(item).toMatchObject({
      name: "FEATURE_FLAG",
      required: false,
      valid: true,
      valuePassed: false,
    })
    expect(isEnvValid([item])).toBe(true)
  })

  it("treats a defaulted var as optional", () => {
    const [item] = validateEnv(
      z.object({ LEVEL: z.string().default("info") }),
      {},
    )
    expect(item.required).toBe(false)
    expect(item.valid).toBe(true)
    expect(isEnvValid([item])).toBe(true)
  })

  // Intentional asymmetry: an optional var that is present but invalid does
  // NOT block (valid: true), yet still renders ❌ in the table. Pin both halves
  // so a refactor can't silently flip either one.
  it("does not block an invalid optional var, but marks it ❌", () => {
    const [item] = validateEnv(
      z.object({ TAG: z.string().min(5).optional() }),
      { TAG: "ab" },
    )
    expect(item.required).toBe(false)
    expect(item.valid).toBe(true) // does not block the build
    expect(item.valuePassed).toBe(true)
    expect(item.error).toBeTruthy()
    expect(isEnvValid([item])).toBe(true) // build proceeds
    expect(envCheckValidEmoji(item)).toBe("❌") // but flagged in the table
  })
})

describe("isEnvValid", () => {
  it("is true for an empty schema (the backend's real case)", () => {
    const items = validateEnv(z.object({}), {})
    expect(items).toEqual([])
    expect(isEnvValid(items)).toBe(true)
  })

  it("blocks when any required item is invalid, ignoring valid ones", () => {
    const items = validateEnv(
      z.object({ PRESENT: z.string(), MISSING: z.string() }),
      { PRESENT: "ok" },
    )
    expect(isEnvValid(items)).toBe(false)
  })
})
