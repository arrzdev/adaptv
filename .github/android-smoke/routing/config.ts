import { index, rootRoute, route } from "@arrzdev/adaptv/routes"

//The android smoke's routes, copied over examples/basic/src/routing before the build:
//a home with a link, and a form page to type into and go back from.
export const routes = rootRoute([
  index("pages/home.page.tsx"),
  route("/form", "pages/form.page.tsx"),
])

export default routes
