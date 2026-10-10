import { createFileRoute } from "@tanstack/react-router"
import { viaClientCore } from "../fns/client-core"

export const Route = createFileRoute("/client-core")({
  loader: () => viaClientCore(),
})
