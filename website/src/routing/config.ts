import { index, rootRoute, route } from "adaptv/routes"

//adaptv owns the root route — declare only the children.
export const routes = rootRoute([
  index("pages/home.page.tsx"),
  route("/docs", "pages/docs.page.tsx"),
  route("/docs/$slug", "pages/docs/doc.page.tsx"),
  route("/blog", "pages/blog.page.tsx"),
  route("/blog/$slug", "pages/blog/post.page.tsx"),
])

export default routes
