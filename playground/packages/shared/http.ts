import type { Context, TypedResponse } from "hono"
import { Hono } from "hono"
import type { HonoBase } from "hono/hono-base"
import type { Endpoint, ExtractSchema, Schema } from "hono/types"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import type { JSONValue } from "hono/utils/types"

type ErrorCodeFrom<
  Codes extends Record<string, readonly [string, ContentfulStatusCode]>,
> = keyof Codes & string

//generic Hono factory for any backend app; pass this worker's Bindings + Variables.
export function newEndpoint<
  Bindings extends object = Record<string, unknown>,
  Variables extends object = Record<string, unknown>,
>(): Hono<{ Bindings: Bindings; Variables: Variables }> {
  return new Hono<{ Bindings: Bindings; Variables: Variables }>()
}

//response envelope: bind once to an app's error codes for typed ok() + error().
export type ApiErrorBody<C extends string = string> = {
  status: "error"
  error_code: C
}

export function createApiEnvelope<
  const Codes extends Record<
    string,
    readonly [string, ContentfulStatusCode]
  >,
>(codes: Codes) {
  type ErrorCode = ErrorCodeFrom<Codes>

  type ErrorHttpStatus<C extends ErrorCode> = {
    [K in ErrorCode]: Codes[K][1]
  }[C]

  //a real Response (usable in onError / middleware) that also carries the typed
  //envelope, so the RPC client still sees the error shape — no errorMiddleware.
  function error<C extends ErrorCode>(
    c: Context,
    error_code: C,
  ): Response &
    TypedResponse<ApiErrorBody<C>, ErrorHttpStatus<C>, "json"> {
    const body: ApiErrorBody<C> = { status: "error", error_code }
    const status = codes[error_code][1]
    return c.json(body, status) as unknown as Response &
      TypedResponse<ApiErrorBody<C>, ErrorHttpStatus<C>, "json">
  }

  function ok(
    c: Context,
  ): TypedResponse<{ status: "success" }, 200, "json">
  function ok<T extends JSONValue>(
    c: Context,
    data: T,
  ): TypedResponse<{ status: "success"; data: T }, 200, "json">
  function ok<T extends JSONValue, S extends ContentfulStatusCode>(
    c: Context,
    data: T,
    httpStatus: S,
  ): TypedResponse<{ status: "success"; data: T }, S, "json">
  function ok(
    c: Context,
    data?: unknown,
    httpStatus?: ContentfulStatusCode,
  ): TypedResponse<unknown, ContentfulStatusCode, "json"> {
    if (data === undefined && httpStatus === undefined)
      return c.json({ status: "success" }, 200) as TypedResponse<
        { status: "success" },
        200,
        "json"
      >
    const status = (httpStatus ?? 200) as ContentfulStatusCode
    return c.json({ status: "success", data }, status) as TypedResponse<
      unknown,
      ContentfulStatusCode,
      "json"
    >
  }

  return { ok, error }
}

/** HTTP statuses returned by `error()` for any code in the app's map. */
export type ApiErrorHttpStatus<
  Codes extends Record<string, readonly [string, ContentfulStatusCode]>,
> = {
  [K in ErrorCodeFrom<Codes>]: Codes[K][1]
}[ErrorCodeFrom<Codes>]

type WithApiErrorsOnEndpoint<
  E extends Endpoint,
  Codes extends Record<string, readonly [string, ContentfulStatusCode]>,
> = E extends {
  input: infer I
  output: infer O
  outputFormat: infer F
  status: infer St
}
  ? {
      input: I
      output: O | ApiErrorBody<ErrorCodeFrom<Codes>>
      outputFormat: F
      status: St | ApiErrorHttpStatus<Codes>
    }
  : never

type WithApiErrorsOnRoute<
  R extends Record<string, Endpoint>,
  Codes extends Record<string, readonly [string, ContentfulStatusCode]>,
> = {
  [M in keyof R]: R[M] extends Endpoint
    ? WithApiErrorsOnEndpoint<R[M], Codes>
    : never
}

/** Union global API error JSON onto every path in a flattened Hono schema. */
export type WithApiErrorsOnSchema<
  S extends Schema,
  Codes extends Record<string, readonly [string, ContentfulStatusCode]>,
> = {
  [K in keyof S]: S[K] extends Record<string, Endpoint>
    ? WithApiErrorsOnRoute<S[K], Codes>
    : never
}

/**
 * RPC client app type: each route's JSON body may be success or `ApiErrorBody`
 * (explicit `error()` responses and global `onError` / middleware envelopes).
 */
type ExtractAppSchema<App> =
  ExtractSchema<App> extends Schema ? ExtractSchema<App> : Schema

export type ClientRoutesInterface<
  App,
  Codes extends Record<string, readonly [string, ContentfulStatusCode]>,
> = App extends HonoBase<
  infer E,
  infer _Schema extends Schema,
  infer BasePath,
  infer CurrentPath
>
  ? HonoBase<
      E,
      WithApiErrorsOnSchema<ExtractAppSchema<App>, Codes>,
      BasePath,
      CurrentPath
    >
  : never
