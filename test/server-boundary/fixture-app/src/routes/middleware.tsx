import { createFileRoute } from "@tanstack/react-router"
import { viaMiddleware } from "../fns/middleware"

export const Route = createFileRoute("/middleware")({
  loader: () => typeof viaMiddleware,
})
