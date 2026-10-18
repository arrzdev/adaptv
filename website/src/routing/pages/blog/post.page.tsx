import { Link, View } from "adaptv/components"
import { createFileRoute, notFound } from "adaptv/router"
import { ArrowLeft } from "lucide-react"
import { OnThisPage } from "@/components/on-this-page"
import { Prose } from "@/components/prose"
import { SitePage } from "@/components/site-page"
import { POSTS, type Post } from "@/content/blog"
import { RSS_LINK } from "@/content/feeds"
import { articleJsonLd, socialHead } from "@/content/site"

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = POSTS.find((item) => item.slug === params.slug)
    if (!post) throw notFound()
    return {
      slug: post.slug,
      title: post.title,
      summary: post.summary,
      seoTitle: post.seoTitle,
      seoDescription: post.seoDescription,
      date: post.date,
      author: post.author,
    }
  },
  head: ({ loaderData }) =>
    loaderData
      ? socialHead({
          title: loaderData.title,
          tabTitle: loaderData.seoTitle,
          description: loaderData.seoDescription ?? loaderData.summary,
          path: `/blog/${loaderData.slug}`,
          published: loaderData.date,
          links: [RSS_LINK],
          jsonLd: articleJsonLd({
            title: loaderData.title,
            description: loaderData.seoDescription ?? loaderData.summary,
            path: `/blog/${loaderData.slug}`,
            section: { name: "Blog", path: "/blog" },
            published: loaderData.date,
            author: loaderData.author,
          }),
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
      {/* On the floating header's lines (`site-container`). The head spans the container;
          below it the body keeps a reading measure on the left edge, and from lg a side
          column on the right edge holds the post's facts and its headings */}
      <article className="site-container py-12 md:py-16">
        <View className="gap-5 border-border border-b pb-10">
          <Link
            to="/blog"
            smartBack
            className="flex items-center gap-1.5 self-start text-[14px] text-muted hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            Blog
          </Link>
          {/* from lg the side column says this */}
          <span className="font-mono text-[12px] text-muted uppercase tracking-wider lg:hidden">
            {post.kind} · {post.date}
            {post.author ? ` · ${post.author}` : ""}
          </span>
          <h1 className="max-w-4xl text-balance font-semibold text-[clamp(1.875rem,1.1rem+3.4vw,3rem)] text-foreground leading-[1.06] tracking-[-0.035em]">
            <WholeTokens text={post.title} />
          </h1>
          <p className="max-w-3xl text-[18px] text-subtle leading-relaxed">
            {post.summary}
          </p>
        </View>
        <View className="gap-12 pt-10 lg:flex-row lg:justify-between">
          <View className="min-w-0 max-w-2xl flex-1">
            <Prose blocks={post.blocks} />
          </View>
          <aside className="hidden w-56 shrink-0 lg:block">
            <View className="sticky top-24 gap-8">
              <PostFacts post={post} />
              <OnThisPage blocks={post.blocks} />
            </View>
          </aside>
        </View>
      </article>
    </SitePage>
  )
}

function PostFacts({ post }: { post: Post }) {
  const facts = [
    ["Published", post.date],
    ["Kind", post.kind],
    ...(post.author ? [["By", post.author]] : []),
  ]
  return (
    <dl className="flex flex-col gap-3 text-[13.5px]">
      {facts.map(([term, value]) => (
        <View key={term} className="gap-0.5">
          <dt className="font-mono text-[12px] text-muted uppercase tracking-[0.08em]">
            {term}
          </dt>
          <dd className="text-subtle">{value}</dd>
        </View>
      ))}
    </dl>
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
