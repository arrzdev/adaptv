import chopchop from "@/assets/built-with/chopchop.webp?adaptv-image"
import veralens from "@/assets/built-with/veralens.webp?adaptv-image"
import { PhoneFrame } from "@/components/frames"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"

/*
 * Two apps that run on adaptv, each on a real screen. Both run on `packages/nativ`, the
 * in-repo predecessor of adaptv, not the published package, and the lede says so: never
 * claim either installs `adaptv` or link a package.json that shows nativ. The lines say
 * what each app does and nothing more (no dates, numbers or customers). Each screen is one file in
 * src/assets/built-with/, rendered by scripts/capture-chopchop.ts and
 * scripts/capture-veralens.ts, so a device screenshot of the same screen replaces it
 * without a code change.
 */
const APPS = [
  {
    name: "ChopChop",
    line: "A task app that works offline and syncs when you sign in.",
    platform: "ios",
    image: chopchop,
    alt: "ChopChop's task list with one task swiped open to Archive and Delete, in an iPhone frame.",
  },
  {
    name: "Veralens",
    line: "An API that turns a PDF, scan or photo into typed fields.",
    platform: "android",
    image: veralens,
    alt: "Veralens' home page, a stack of documents over the line “Any document into clean data in one API call”, in an Android frame.",
  },
] as const

/** Two phones side by side; on a phone, one under the other. */
export function BuiltWith() {
  return (
    <Section
      title="Built with adaptv"
      //so a reader who opens either repo finds no contradiction with the title (TUD-440)
      lede="Both apps run on adaptv's in-repo predecessor (nativ); moving them to the published package is next."
    >
      <ul className="grid justify-items-center gap-14 sm:grid-cols-2 sm:gap-10 md:mx-auto md:w-full md:max-w-3xl">
        {APPS.map((app, i) => (
          <li key={app.name} className="w-full max-w-[280px]">
            <Reveal delay={i * 0.08} className="flex flex-col items-center">
              <PhoneFrame
                platform={app.platform}
                className={
                  //the Pixel's screen is taller for its width (2400/1080 vs 2556/1179): narrower, every frame is one height
                  app.platform === "ios" ? "w-full" : "w-[97.2%]"
                }
              >
                <img
                  src={app.image.src}
                  width={app.image.width}
                  height={app.image.height}
                  alt={app.alt}
                  //below the fold: never ahead of the hero's iPhone, the page's largest paint
                  loading="lazy"
                  fetchPriority="low"
                  decoding="async"
                  draggable={false}
                  //a failed image shows its alt on the dark screen, not only the broken-image icon
                  className="block h-auto w-full select-none bg-[#0a0a0c] text-white/70 text-xs"
                />
              </PhoneFrame>
              <p className="mt-6 font-semibold text-[16px] tracking-[-0.01em]">
                {app.name}
              </p>
              <p className="mt-1 text-balance text-center text-[15px] text-subtle">
                {app.line}
              </p>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  )
}
