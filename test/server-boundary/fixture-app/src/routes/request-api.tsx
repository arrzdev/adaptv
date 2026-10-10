import { createFileRoute } from "@tanstack/react-router"
import { viaRequestApi } from "../fns/request-api"

export const Route = createFileRoute("/request-api")({
  loader: () => viaRequestApi(),
})
