import { createFileRoute } from "@tanstack/react-router"
import { viaAdaptvSubpath } from "../fns/adaptv-subpath"

export const Route = createFileRoute("/adaptv-subpath")({
  loader: () => viaAdaptvSubpath(),
})
