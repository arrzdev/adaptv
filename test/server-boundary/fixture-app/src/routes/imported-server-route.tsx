//A server route whose options come from another module.
import { createFileRoute } from "@tanstack/react-router"
import { serverOptions } from "../lib/route-options"

export const Route = createFileRoute("/imported-server-route")(
  serverOptions,
)
