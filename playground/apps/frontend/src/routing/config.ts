import { index, layout, rootRoute, route } from "@arrzdev/adaptv/routes"

//nativ owns the root route (stamped __root.gen.tsx) — declare only the children.
//routing files follow the repo's {domain}.{role} convention: `*.page.tsx` for
//pages, `*.layout.tsx` for nested layouts (see core/repository-layout).
export const routes = rootRoute([
  //app-wide providers (query client, auth, local store) wrap every page
  layout("providers", "layouts/providers.layout.tsx", [
    index("pages/todos.page.tsx"),
    route("/settings", "pages/settings.page.tsx"),
  ]),
])

export default routes
