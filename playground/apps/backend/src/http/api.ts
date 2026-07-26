import { newEndpoint } from "@repo/shared/http"
import type { Env } from "@/env/registry"
import { error } from "@/http/envelope"
import { errorCatcher } from "@/http/middlewares/error-catcher"
import { corsPlugin } from "@/http/plugins/cors"
import { v1Routes } from "@/http/routes"

//composed transport api: cors, global error catcher, v1 routes, not-found.
//the worker entrypoint just bootstraps env and delegates to api.fetch.
export const api = newEndpoint<Env>()
  .use("*", corsPlugin()) //setup cors plugin
  .onError(errorCatcher) //catch + envelope unhandled throws
  .route("/api/v1", v1Routes) //define v1 routes
  .all("*", (c) => error(c, "endpoint_not_found")) //handle route not found
