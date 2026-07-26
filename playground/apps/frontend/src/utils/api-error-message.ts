import { ERROR_CODES } from "@repo/backend/http/errors"

//user-facing text for a caught error. CH surfaces messages server-side via the
//shared ERROR_CODES map (error_code -> [message, status]); the envelope only
//carries error_code, so we resolve it here. Thrown Errors already hold a
//display-ready .message (network/sync/mutation throwers), so pass those through
//untouched — re-mapping a message through ERROR_CODES would just fall back to generic.
const CODE_MESSAGES = ERROR_CODES as Record<
  string,
  readonly [string, number]
>

function messageForCode(code: string): string {
  return CODE_MESSAGES[code]?.[0] ?? ERROR_CODES.internal_server_error[0]
}

export function apiErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (err != null && typeof err === "object" && "error_code" in err) {
    const code = (err as { error_code?: string }).error_code
    if (typeof code === "string") return messageForCode(code)
  }
  return ERROR_CODES.internal_server_error[0]
}
