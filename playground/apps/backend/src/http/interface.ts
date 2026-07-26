import type { ClientRoutesInterface } from "@repo/shared/http"
import type { api } from "@/http/api"
import type { ERROR_CODES } from "@/http/errors"

//the typed RPC interface the frontend builds its client from (hc<RoutesInterface>):
//every route's success shape plus the global error envelope, derived from the api.
export type RoutesInterface = ClientRoutesInterface<
  typeof api,
  typeof ERROR_CODES
>
