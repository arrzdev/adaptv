import { zValidator } from "@hono/zod-validator"
import type { ValidationTargets } from "hono"
import type { ZodType } from "zod"
import { CustomError } from "@/http/errors"

//Zod validation as an early-return middleware: a failure throws invalid_input,
//the global handler renders the envelope, and the route handler never runs — so
//handlers read the typed c.req.valid(target) and assume the input is already good.
//don't annotate the return type: it would flatten the inference c.req.valid needs.
export function valid<
  Target extends keyof ValidationTargets,
  Schema extends ZodType,
>(target: Target, schema: Schema) {
  return zValidator(target, schema, (result) => {
    if (!result.success) throw new CustomError("invalid_input")
  })
}
