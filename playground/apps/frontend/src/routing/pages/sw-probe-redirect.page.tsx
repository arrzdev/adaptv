import { createFileRoute, redirect } from "adaptv/router"

/*
 * A route that never renders: it redirects, the way a protected page does.
 *
 * This is a FIXTURE, not a demo — it exists so `e2e-sw/redirect.spec.ts` has a
 * real redirect to navigate into. Under `render: "ssr"` the throw below happens
 * on the server and the document request is answered with a 3xx and a `Location`
 * header, which is the exact shape of "you are not logged in, go to /login" —
 * the most common thing an SSR app does, and the one response shape the service
 * worker sits in front of and can break outright.
 *
 * Under `render: "spa"` there is no server in the path, so the same throw runs in
 * the client router after the shell boots. Both are worth asserting, and they are
 * different mechanisms reached through the same URL.
 */
export const Route = createFileRoute("/_providers/sw-probe-redirect")({
  beforeLoad: () => {
    throw redirect({ to: "/settings" })
  },
})
