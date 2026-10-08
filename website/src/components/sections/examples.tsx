import newTask from "@/assets/examples/new-task.png?adaptv-image"
import sort from "@/assets/examples/sort.png?adaptv-image"
import tasks from "@/assets/examples/tasks.png?adaptv-image"
import { PhoneFrame } from "@/components/frames"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"

/*
 * Screens of the playground's task app, labelled as examples: nobody ships it, and the
 * page must not say anyone does. Each screen is one file in src/assets/examples/, today
 * a stand-in rendered by scripts/capture-examples.ts, so a device screenshot of the same
 * screen replaces it without a code change.
 */
const EXAMPLES = [
  {
    name: "Task list",
    line: "Tasks saved on the device.",
    platform: "ios",
    image: tasks,
    alt: "An example task app's list of five tasks, in an iPhone frame.",
  },
  {
    name: "New task",
    line: "A sheet to add a task.",
    platform: "android",
    image: newTask,
    alt: "An example task app's sheet for adding a task, in an Android frame.",
  },
  {
    name: "Sort",
    line: "A menu to sort your tasks.",
    platform: "ios",
    image: sort,
    alt: "An example task app's menu of sort orders, in an iPhone frame.",
  },
] as const

/**
 * Three phones in a row; on a phone, a row that scrolls sideways with the next screen
 * peeking in, so the peek is the only hint it scrolls.
 */
export function Examples() {
  return (
    <Section title="Examples you can build">
      <ul className="-mx-6 flex snap-x snap-mandatory scroll-px-6 gap-5 overflow-x-auto px-6 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-10 md:overflow-visible md:px-0 md:pb-0">
        {EXAMPLES.map((example, i) => (
          <li
            key={example.name}
            className="w-[78%] shrink-0 snap-start md:w-auto"
          >
            <Reveal delay={i * 0.08} className="flex flex-col items-center">
              <PhoneFrame
                platform={example.platform}
                className={
                  //the Pixel's screen is taller for its width (2400/1080 vs 2556/1179): narrower, every frame is one height
                  example.platform === "ios"
                    ? "w-full max-w-[280px]"
                    : "w-[97.6%] max-w-[273px]"
                }
              >
                <img
                  src={example.image.src}
                  width={example.image.width}
                  height={example.image.height}
                  alt={example.alt}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  //a failed image shows its alt on the dark screen, not only the broken-image icon
                  className="block h-auto w-full select-none bg-[#0a0a0c] text-white/70 text-xs"
                />
              </PhoneFrame>
              <p className="mt-6 font-semibold text-[16px] tracking-[-0.01em]">
                {example.name}
              </p>
              <p className="mt-1 text-[15px] text-subtle">{example.line}</p>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  )
}
