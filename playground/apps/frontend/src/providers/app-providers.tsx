import { useLocation } from "@arrzdev/adaptv/router"
import { QueryClientProvider } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { CatchBoundary } from "@/components/ui/catch-boundary"
import { AppDbProvider } from "@/providers/app-db-provider"
import { queryClient } from "@/providers/tanstack-query-provider"

//dev-only: forward device/browser console + errors to the LAN log sink. client-only
//+ import.meta.env.DEV-gated, so it's tree-shaken from production builds.
if (import.meta.env.DEV && typeof window !== "undefined") {
  void import("@/dev/debug-telemetry").then((telemetry) =>
    telemetry.installDebugTelemetry(),
  )
}

/** App-wide provider tree mounted by the nativ shell around the router outlet. */
export default function AppProviders({
  children,
}: {
  children: ReactNode
}) {
  const location = useLocation()

  return (
    <QueryClientProvider client={queryClient}>
      <AppDbProvider>
        <CatchBoundary getResetKey={() => location.pathname}>
          {children}
        </CatchBoundary>
      </AppDbProvider>
    </QueryClientProvider>
  )
}
