import { Logger } from "@repo/shared/logging"
import type { Context } from "hono"
import { error } from "@/http/envelope"
import { CustomError } from "@/http/errors"

const log = new Logger("error-catcher")

//global catcher: log unexpected failures once, reply with the mapped error code.
export function errorCatcher(caught: unknown, c: Context) {
  const errorCode =
    caught instanceof CustomError
      ? caught.errorCode
      : "internal_server_error"

  //log unexpected failures only; domain CustomErrors bubble here by design
  if (!(caught instanceof CustomError)) {
    const method = c.req.method
    const route = new URL(c.req.url).pathname
    const trace =
      caught instanceof Error
        ? {
            name: caught.name,
            message: caught.message,
            stack: caught.stack,
            ...(caught.cause !== undefined ? { cause: caught.cause } : {}),
          }
        : { type: typeof caught, value: caught }

    log.error(
      "api_unhandled_exception",
      caught instanceof Error ? caught : undefined,
      {
        error_code: errorCode,
        method,
        route,
        trace,
      },
    )
  }

  return error(c, errorCode)
}
