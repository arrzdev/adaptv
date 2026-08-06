//via adaptv's barrel, not @tanstack/react-router directly — adaptv keeps TanStack
//out of the app's surface (see the route-tree opacity check in its Vite plugin).
import { createFileRoute, Outlet } from "@arrzdev/adaptv/router"
import AppProviders from "@/providers/app-providers"

//Pathless layout that mounts the app-wide provider tree around every page.
//adaptv has no `providers` config field on purpose — an app-wide provider tree
//is just a layout route (see AdaptvAppConfig's note), so it nests and scopes
//through the router's own composition model.
//
//Load-bearing: AppDbProvider lives in here and is what seeds the local store and
//then calls setAppBootstrapReady(). The splash (mounted by adaptv outside the
//outlet) self-unmounts off that same module-level gate, so if this layout is not
//in the route tree the splash never dismisses.
export const Route = createFileRoute("/_providers")({
  component: ProvidersLayout,
})

function ProvidersLayout() {
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  )
}
