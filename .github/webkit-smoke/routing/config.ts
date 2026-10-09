import { index, rootRoute, route } from "adaptv/routes"

//The webkit smoke's routes (the android smoke's, without styling), copied over the scaffold's src/routing before the build:
//a home with a link, and a form page to type into and go back from.
export const routes = rootRoute([
  index("pages/home.page.tsx"),
  route("/form", "pages/form.page.tsx"),
])

export default routes
