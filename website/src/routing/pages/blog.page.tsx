import { Link, View } from "adaptv/components"
import { createFileRoute } from "adaptv/router"
import { ArrowRight } from "lucide-react"
import { Inline } from "@/components/inline"
import { SitePage } from "@/components/site-page"
import { POSTS, type Post } from "@/content/blog"
import { BLOG_LEDE as LEDE, RSS_LINK } from "@/content/feeds"
import { socialHead } from "@/content/site"
import { cn } from "@/utils/cn"

export const Route = createFileRoute("/blog")({
  component: BlogIndex,
  head: () =>
    socialHead({
      title: "Blog",
      tabTitle: "iOS PWA field notes: bugs and fixes | adaptv",
      description:
        "Field notes on iOS PWA and Safari bugs, with the WebKit rules behind them and the fixes adaptv ships. Keyboard, viewport, theme colour.",
      path: "/blog",
      links: [RSS_LINK],
    }),
})

//newest first; posts of the same day keep their order in POSTS (sort is stable)
const NEWEST_FIRST = [...POSTS].sort((a, b) => b.date.localeCompare(a.date))
//the latest post leads as a full-width card, the rest follow in the grid
const [LATEST, ...EARLIER] = NEWEST_FIRST

function BlogIndex() {
  return (
    <SitePage>
      {/* on the floating header's lines; the copy keeps a reading measure */}
      <View className="site-container gap-10 py-14 md:py-20">
        <View className="max-w-3xl gap-4">
          <h1 className="font-semibold text-[44px] text-foreground leading-[1.05] tracking-[-0.035em]">
            Blog
          </h1>
          <p className="text-[18px] text-subtle leading-relaxed">{LEDE}</p>
          <p className="text-[15.5px] text-subtle leading-relaxed">
            <Inline text="The [docs](/docs) cover every component, hook and command; the [home page](/) shows what adaptv is." />
          </p>
        </View>
        <View className="gap-4">
          {LATEST ? <FeaturedCard post={LATEST} /> : null}
          {/* one column on a phone, two from md: two lines of ~45 characters keep a
            summary readable, where three columns cut it to a few words a line */}
          <View className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {EARLIER.map((post) => (
              <Link
                key={post.slug}
                to="/blog/$slug"
                params={{ slug: post.slug }}
                className="flex h-full flex-col gap-2.5 rounded-2xl border border-border bg-surface p-6 hover:border-brand/50"
              >
                <PostKicker post={post} />
                <span className="text-pretty font-semibold text-[21px] text-foreground leading-snug tracking-[-0.02em]">
                  {post.title}
                </span>
                <span className="text-[15px] text-subtle leading-relaxed">
                  {post.summary}
                </span>
              </Link>
            ))}
          </View>
        </View>
      </View>
    </SitePage>
  )
}

function PostKicker({ post }: { post: Post }) {
  return (
    <span className="font-mono text-[12px] text-muted uppercase tracking-wider">
      <span className={cn(post.kind === "Release" && "text-brand")}>
        {post.kind}
      </span>{" "}
      · {post.date}
    </span>
  )
}

function FeaturedCard({ post }: { post: Post }) {
  return (
    <Link
      to="/blog/$slug"
      params={{ slug: post.slug }}
      className="group dots flex flex-col gap-4 rounded-3xl border border-border bg-surface p-7 hover:border-brand/50 md:p-12"
    >
      <span className="font-mono text-[12px] text-brand uppercase tracking-wider">
        Latest
      </span>
      <PostKicker post={post} />
      <span className="max-w-4xl text-balance font-semibold text-[clamp(1.625rem,1rem+2.4vw,2.75rem)] text-foreground leading-[1.08] tracking-[-0.035em]">
        {post.title}
      </span>
      <span className="max-w-3xl text-[16px] text-subtle leading-relaxed md:text-[18px]">
        {post.summary}
      </span>
      <span className="mt-2 flex flex-row items-center gap-1.5 font-medium text-[15px] text-foreground">
        Read the post
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  )
}
