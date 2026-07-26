import { createApiEnvelope } from "@repo/shared/http"
import { ERROR_CODES } from "@/http/errors"

//ok() + error() response builders bound to this app's codes.
//routes, middleware, and the global catcher import them from here.
export const { ok, error } = createApiEnvelope(ERROR_CODES)
