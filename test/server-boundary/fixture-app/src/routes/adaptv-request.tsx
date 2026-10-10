import { createFileRoute } from "@tanstack/react-router"
import { viaAdaptvRequest } from "../fns/adaptv-request"

export const Route = createFileRoute("/adaptv-request")({
  loader: () => viaAdaptvRequest(),
})
