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
    line: "A task app for your phone and the web. Add a task, check it off, keep going.",
    platform: "ios",
    image: chopchop,
    alt: "ChopChop's task list, one task half swiped to show its Archive action, in an iPhone frame.",
  },
  {
    name: "Veralens",
    line: "Turn documents into structured data. Send a file, get back JSON in the shape you define.",
    platform: "android",
    image: veralens,
    alt: "Veralens' home page, a stack of documents over the line “Any document into clean data in one API call”, in an Android frame.",
  },
] as const

/**
 * Two phones side by side; on a phone, a row that scrolls sideways with the next screen
 * peeking in, so §3 stays one phone tall and the peek is the only hint it scrolls.
 */
export function BuiltWith() {
  return (
    <Section
      title="Built with adaptv"
      //so a reader who opens either repo finds no contradiction with the title (TUD-440)
      lede="Both apps run on adaptv's in-repo predecessor (nativ); moving them to the published package is next."
    >
      <ul className="-mx-6 flex snap-x snap-mandatory scroll-px-6 gap-5 overflow-x-auto px-6 pb-2 sm:mx-auto sm:grid sm:w-full sm:max-w-3xl sm:grid-cols-2 sm:justify-items-center sm:gap-10 sm:overflow-visible sm:px-0 sm:pb-0">
        {APPS.map((app, i) => (
          <li
            key={app.name}
            className="w-[80%] max-w-[280px] shrink-0 snap-start sm:w-full"
          >
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
