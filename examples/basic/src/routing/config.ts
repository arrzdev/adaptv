import { index, rootRoute } from "@arrzdev/adaptv/routes"

//adaptv owns the root route — declare only the children.
export const routes = rootRoute([index("pages/home.page.tsx")])

export default routes
