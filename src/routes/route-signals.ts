import type { AnyRedirect, NotFoundError } from "@tanstack/react-router"
import {
  isRedirect as engineIsRedirect,
  notFound as engineNotFound,
} from "@tanstack/react-router"

//`notFound` and `isRedirect` are the router's own functions, re-typed so their
//signatures name adaptv's types. The values are the same functions: nothing here
//runs differently. Interfaces over the engine's types, not aliases of them, because
//TypeScript prints an alias by the type it aliases, and that type's name is the
//engine's. → docs/decisions/facade-and-opacity.md §1

/** What `notFound` takes and throws: `data` reaches `notFoundScreen` as a prop. */
export interface NotFoundOptions extends NotFoundError {}

/** The redirect `redirect()` throws, as `isRedirect` narrows to it. */
export interface RouteRedirect extends AnyRedirect {}

/** Throw it from a loader or `beforeLoad` to render the not-found screen. */
export const notFound: (options?: NotFoundOptions) => NotFoundOptions =
  engineNotFound

/** Whether a caught value is a redirect `redirect()` threw. */
export const isRedirect: (value: unknown) => value is RouteRedirect =
  engineIsRedirect
