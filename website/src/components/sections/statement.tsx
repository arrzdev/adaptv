import { View } from "@arrzdev/adaptv/components"
import { Reveal } from "@/components/reveal"

/** One paragraph, set large. The whole pitch, for the reader who scrolls no further. */
export function Statement() {
  return (
    <section className="sheet ruled">
      <View className="px-6 py-24 md:px-10 md:py-36">
        <Reveal>
          <p className="max-w-[62rem] text-balance font-medium text-[clamp(1.6rem,3.6vw,2.9rem)] leading-[1.14] tracking-[-0.03em]">
            A web view is the fastest way to ship an app everywhere.{" "}
            <span className="text-muted">
              It is also why that app rubber-bands past its edges, lights up
              buttons you only scrolled over, and zooms in when you tap an
              input. Users can't name those things. They just say it feels
              cheap.
            </span>{" "}
            adaptv fixes them by default.
          </p>
        </Reveal>
      </View>
    </section>
  )
}
