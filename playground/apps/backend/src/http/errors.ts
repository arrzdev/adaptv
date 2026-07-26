import type { ContentfulStatusCode } from "hono/utils/http-status"

//---- codes ----------------

type ErrorCodeEntry = readonly [
  message: string,
  status: ContentfulStatusCode,
]

//maps backend error_code strings to [user-facing message, HTTP status]
export const ERROR_CODES = {
  invalid_request: [
    "The request could not be processed. Check the data and try again.",
    400,
  ],
  invalid_input: ["Invalid input. Check the data and try again.", 400],
  internal_server_error: [
    "An unexpected error occurred. Please try again.",
    500,
  ],
  endpoint_not_found: ["The requested endpoint does not exist.", 404],
  rate_limit_exceeded: ["Too many requests. Please try again later.", 429],
  unauthorized: ["You must be signed in to do that.", 401],
  todo_not_found: ["That todo was not found.", 404],
} as const satisfies Record<string, ErrorCodeEntry>

export type ErrorCode = keyof typeof ERROR_CODES

//---- domain error ----------------

//thrown by services/middleware; the global handler maps errorCode to a response.
export class CustomError extends Error {
  override readonly name = "CustomError"

  constructor(
    public readonly errorCode: ErrorCode,
    cause?: Error,
  ) {
    super(errorCode, cause !== undefined ? { cause } : undefined)
  }
}
