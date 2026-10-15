import { Link, View } from "adaptv/components"
import { ArrowRight } from "lucide-react"
import { Reveal } from "@/components/reveal"

/**
 * The closing: the title over one large app-icon tile carrying the adaptv ring, with a soft
 * brand glow under the text. Expo's closing idea in CSS alone, no canvas (landing-v4 §2.6).
 */
export function FinalCta() {
  return (
    <section className="sheet relative overflow-hidden">
      <div
        data-icon-tile
        className="pointer-events-none absolute top-1/2 left-1/2 aspect-square w-[min(86vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-[30%] bg-card shadow-[inset_0_2px_40px_color-mix(in_oklab,var(--brand)_10%,transparent)]"
      >
        <div className="absolute inset-[26%] rounded-full border-[clamp(14px,4vw,26px)] border-[color-mix(in_oklab,var(--brand)_22%,transparent)] blur-[1px]" />
      </div>
      <div className="pointer-events-none absolute top-[60%] left-1/2 h-[260px] w-[min(90vw,620px)] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--brand)_35%,transparent),transparent)] opacity-50 blur-[40px]" />
      <View className="relative items-center px-6 pt-40 pb-37.5 text-center">
        <Reveal variant="head" className="flex flex-col items-center">
          <h2 className="text-balance font-semibold text-[clamp(2.6rem,1.3rem+4.2vw,4.5rem)] leading-none tracking-[-0.045em]">
            Start with the quick start
          </h2>
          <p className="mt-5 max-w-[26rem] text-[17px] text-subtle leading-[1.55]">
            Clone the repository and run the playground on a simulator or your
            phone.
          </p>
          <View row className="mt-7 flex-wrap justify-center gap-3">
            <Link
              to="/docs/$slug"
              params={{ slug: "quick-start" }}
              className="group flex h-11 flex-row items-center gap-2 rounded-full bg-foreground px-6 font-medium text-[15px] text-background transition-transform hover:scale-[1.02]"
            >
              Read the quick start
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </View>
        </Reveal>
      </View>
    </section>
  )
}
