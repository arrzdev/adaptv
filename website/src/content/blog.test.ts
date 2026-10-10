import { describe, expect, it } from "vitest"
import { POSTS } from "./blog"

//the byline is arrz.dev on every post (TUD-133); a post that omits it or signs
//another name fails here instead of shipping
describe("blog posts", () => {
  it.each(POSTS.map((post) => [post.slug, post.author]))(
    "%s is signed arrz.dev",
    (_slug, author) => {
      expect(author).toBe("arrz.dev")
    },
  )
})
