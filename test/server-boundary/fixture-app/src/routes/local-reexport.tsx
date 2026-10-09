import { createFileRoute } from "@tanstack/react-router"
import { viaLocalReexport } from "../fns/local-reexport"

export const Route = createFileRoute("/local-reexport")({
  loader: () => viaLocalReexport(),
})
