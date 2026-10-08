import { Link, View } from "adaptv/components"
import { createFileRoute, notFound } from "adaptv/router"
import { ArrowLeft } from "lucide-react"
import { Prose } from "@/components/prose"
import { SitePage } from "@/components/site-page"
import { POSTS } from "@/content/blog"

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = POSTS.find((item) => item.slug === params.slug)
    if (!post) throw notFound()
    return { slug: post.slug, title: post.title, summary: post.summary }
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Field note"} — adaptv` },
      { name: "description", content: loaderData?.summary ?? "" },
    ],
  }),
  component: PostRoute,
})

function PostRoute() {
  const { slug } = Route.useLoaderData()
  const post = POSTS.find((item) => item.slug === slug)
  if (!post) return null
  return (
    <SitePage>
      <article className="mx-auto w-full max-w-2xl px-5 py-12 md:py-16">
        <View className="gap-5 pb-10">
          <Link
            to="/blog"
            smartBack
            className="flex items-center gap-1.5 text-[14px] text-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Field notes
          </Link>
          <span className="font-mono text-[12px] text-muted uppercase tracking-wider">
            {post.kind} · {post.date}
            {post.author ? ` · ${post.author}` : ""}
          </span>
          <h1 className="text-balance font-semibold text-[40px] text-foreground leading-[1.06] tracking-[-0.035em]">
            {post.title}
          </h1>
          <p className="text-[18px] text-subtle leading-relaxed">
            {post.summary}
          </p>
        </View>
        <Prose blocks={post.blocks} />
      </article>
    </SitePage>
  )
}
