//The shape today's scan catches: `server` written on the call's own options object.
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/literal-server-route")({
  server: {
    handlers: {
      GET: () => new Response("from the server"),
    },
  },
})
