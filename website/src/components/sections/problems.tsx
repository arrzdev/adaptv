import { Link, View } from "adaptv/components"
import { ArrowRight } from "lucide-react"

export type Problem = { slug: string; title: string }

//The posts that answer a search for a mobile web bug, linked from the strongest URL so a
//crawler finds them. Each title is the post's seoTitle, copied here so the home chunk does
//not pull in every post body; problems.test.tsx keeps the two in step.
export const PROBLEMS: readonly Problem[] = [
  {
    slug: "ios-safari-input-zoom-on-focus",
    title: "iOS Safari input zoom on focus: how to disable it",
  },
  {
    slug: "ios-pwa-safe-area-insets-zero",
    title: "env(safe-area-inset-bottom) not working on iOS PWA",
  },
  {
    slug: "disable-pull-to-refresh-overscroll-behavior",
    title: "Disable pull to refresh with overscroll-behavior CSS",
  },
]

/** Plain links under the hero, one per problem; nothing animates in, so nothing shifts. */
export function Problems() {
  return (
    <section className="sheet">
      <View className="mx-auto w-full max-w-[720px] px-4 pt-16 md:px-10">
        <h2 className="text-center font-mono text-[12px] text-muted uppercase tracking-wider">
          Common mobile web problems
        </h2>
        <ul className="mt-4 flex flex-col divide-y divide-border border-border border-y">
          {PROBLEMS.map((problem) => (
            <li key={problem.slug}>
              <Link
                to="/blog/$slug"
                params={{ slug: problem.slug }}
                className="group flex flex-row items-center justify-between gap-4 py-3.5 text-[16px] text-foreground leading-snug hover:text-brand"
              >
                <span className="text-pretty">{problem.title}</span>
                <ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
              </Link>
            </li>
          ))}
        </ul>
      </View>
    </section>
  )
}
