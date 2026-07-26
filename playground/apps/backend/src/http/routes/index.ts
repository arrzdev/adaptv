import { newEndpoint } from "@repo/shared/http"
import {
  authHandlerRoutes,
  socialProviderRoutes,
} from "@/http/routes/auth.routes"
import { syncRoutes } from "@/http/routes/sync.routes"
import { todosRoutes } from "@/http/routes/todos.routes"

export const v1Routes = newEndpoint()
  .route("/todos", todosRoutes)
  .route("/sync", syncRoutes)
  .route("/auth", authHandlerRoutes)
  .route("/social-providers", socialProviderRoutes)
