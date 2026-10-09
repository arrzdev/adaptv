import { Link, View } from "adaptv/components"
import { createFileRoute, notFound } from "adaptv/router"
import { ArrowLeft } from "lucide-react"
import { Prose } from "@/components/prose"
import { SitePage } from "@/components/site-page"
import { POSTS } from "@/content/blog"
import { socialHead } from "@/content/site"

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = POSTS.find((item) => item.slug === params.slug)
    if (!post) throw notFound()
    return {
      slug: post.slug,
      title: post.title,
      summary: post.summary,
      date: post.date,
    }
  },
  head: ({ loaderData }) =>
    loaderData
      ? socialHead({
          title: loaderData.title,
          description: loaderData.summary,
          path: `/blog/${loaderData.slug}`,
          published: loaderData.date,
        })
      : {},
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
            Blog
          </Link>
          <span className="font-mono text-[12px] text-muted uppercase tracking-wider">
            {post.kind} · {post.date}
            {post.author ? ` · ${post.author}` : ""}
          </span>
          <h1 className="text-balance font-semibold text-[clamp(1.875rem,1.1rem+3.4vw,2.5rem)] text-foreground leading-[1.06] tracking-[-0.035em]">
            <WholeTokens text={post.title} />
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

/**
 * Keeps each hyphenated token (`theme-color`, `0.1.0-alpha.0`) on one line: browsers
 * break after a hyphen, and `text-balance` made a title end a line on "theme-".
 */
export function WholeTokens({ text }: { text: string }) {
  return text.split(/(\S+-\S+)/).map((part, index) =>
    index % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts never reorder
      <span key={index} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      part
    ),
  )
}
