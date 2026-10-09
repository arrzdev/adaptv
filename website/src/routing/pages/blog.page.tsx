import { Link, View } from "adaptv/components"
import { createFileRoute } from "adaptv/router"
import { SitePage } from "@/components/site-page"
import { POSTS } from "@/content/blog"
import { socialHead } from "@/content/site"
import { cn } from "@/utils/cn"

const LEDE =
  "Releases, and field notes on what a phone actually does when you put a web page in an app."

export const Route = createFileRoute("/blog")({
  component: BlogIndex,
  head: () => socialHead({ title: "Blog", description: LEDE, path: "/blog" }),
})

//newest first; posts of the same day keep their order in POSTS (sort is stable)
const NEWEST_FIRST = [...POSTS].sort((a, b) => b.date.localeCompare(a.date))

function BlogIndex() {
  return (
    <SitePage>
      <View className="mx-auto w-full max-w-3xl gap-10 px-5 py-14 md:py-20">
        <View className="gap-4">
          <h1 className="font-semibold text-[44px] text-foreground leading-[1.05] tracking-[-0.035em]">
            Blog
          </h1>
          <p className="text-[18px] text-subtle leading-relaxed">{LEDE}</p>
        </View>
        <View className="gap-4">
          {NEWEST_FIRST.map((post) => (
            <Link
              key={post.slug}
              to="/blog/$slug"
              params={{ slug: post.slug }}
              className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-6 hover:border-brand/50"
            >
              <span className="font-mono text-[12px] text-muted uppercase tracking-wider">
                <span className={cn(post.kind === "Release" && "text-brand")}>
                  {post.kind}
                </span>{" "}
                · {post.date}
              </span>
              <span className="font-semibold text-[22px] text-foreground tracking-[-0.02em]">
                {post.title}
              </span>
              <span className="text-[15.5px] text-subtle leading-relaxed">
                {post.summary}
              </span>
            </Link>
          ))}
        </View>
      </View>
    </SitePage>
  )
}
