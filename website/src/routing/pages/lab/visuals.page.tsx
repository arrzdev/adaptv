import { View } from "adaptv/components"
import { createFileRoute } from "adaptv/router"
import type { ReactNode } from "react"
import { Card } from "@/components/card"
import {
  BuildGuardDiagram,
  GesturesDiagram,
  KeyboardDiagram,
  SafeAreasDiagram,
  TargetsDiagram,
} from "@/components/diagram/diagrams"
import { type LabAsset, LabMedia } from "@/components/lab/lab-media"
import { DeviceStage } from "@/components/sections/device-stage"
import { SitePage } from "@/components/site-page"
import { cn } from "@/utils/cn"

/*
 * A review page, not part of the site: for each landing section drawn in CSS, the current
 * version next to asset-based variations (real footage of adaptv's own apps, and art
 * rendered in headless Chrome). Linked from nowhere and kept out of search. The assets live
 * in public/lab/ and are made by website/scripts/lab/.
 */
export const Route = createFileRoute("/lab/visuals")({
  component: LabVisuals,
  head: () => ({
    meta: [
      { title: "Landing visuals, variations — adaptv lab" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
})

type Variant = {
  label: "A" | "B" | "C"
  line: string
  asset: LabAsset
}

const PHONE = { width: 800, height: 860, video: true } as const

const HERO: Variant[] = [
  {
    label: "A",
    line: "Footage: the playground (a real adaptv app) on desktop and phone, the same flow on both, over the rendered aurora.",
    asset: {
      src: "footage/hero-playground",
      width: 1600,
      height: 960,
      video: true,
      alt: "The playground task app in a browser window and on a phone: a task is added from a sheet, a row is swiped, a task is ticked off.",
    },
  },
  {
    label: "B",
    line: "Footage: this website on desktop and phone: scroll, a row swiped, the sheet opened, over to the docs.",
    asset: {
      src: "footage/hero-site",
      width: 1600,
      height: 960,
      video: true,
      alt: "This website in a browser window and on a phone, scrolled and used.",
    },
  },
  {
    label: "C",
    line: "Still: real screenshots of the playground, turned in space over the rendered aurora.",
    asset: {
      src: "stills/hero-3d",
      width: 2400,
      height: 1350,
      alt: "The playground app in a browser window and on a phone, in perspective over coloured light.",
    },
  },
]

type CardSpec = {
  title: string
  body: string
  wide?: boolean
  current: ReactNode
  variants: Variant[]
}

const HARD_PARTS: CardSpec[] = [
  {
    title: "One React app on every screen",
    body: "The same code deploys to the web, installs from the browser, and builds for iOS and Android.",
    wide: true,
    current: <TargetsDiagram />,
    variants: [
      {
        label: "A",
        line: "Footage: one playground session on four screens at once: browser, installed window, iPhone, Android.",
        asset: {
          src: "footage/targets-four",
          width: 1600,
          height: 660,
          video: true,
          alt: "The same app running in a browser, an installed window, an iPhone and an Android phone.",
        },
      },
      {
        label: "B",
        line: "Generated: one light splitting into four streams (canvas, rendered frame by frame).",
        asset: {
          src: "art/trails-split",
          width: 1600,
          height: 760,
          video: true,
          alt: "Light trails leaving one point and splitting into four.",
        },
      },
    ],
  },
  {
    title: "One gesture at a time",
    body: "One controller decides who owns each touch: the sheet, the back swipe or pull-to-refresh.",
    current: <GesturesDiagram />,
    variants: [
      {
        label: "A",
        line: "Footage: this site's own Swipeable rows, close up, dragged by a finger; one row open at a time.",
        asset: {
          src: "footage/gestures-swipe",
          width: 1280,
          height: 600,
          video: true,
          alt: "Notification rows swiped left and right to show their actions.",
        },
      },
      {
        label: "B",
        line: "Footage: the playground's PullToRefresh lab, a short pull that springs back, then a full one.",
        asset: {
          ...PHONE,
          src: "footage/gestures-ptr",
          alt: "A list pulled down on a phone until it refreshes.",
        },
      },
      {
        label: "C",
        line: "Generated: light from every edge converging on one owner.",
        asset: {
          src: "art/trails-converge",
          width: 1200,
          height: 760,
          video: true,
          alt: "Light trails from the edges converging on one point.",
        },
      },
    ],
  },
  {
    title: "The keyboard never hides the field",
    body: "The page stays put, and the sheet rises with the keyboard instead.",
    current: <KeyboardDiagram />,
    variants: [
      {
        label: "A",
        line: "Footage: the playground's create sheet, typing into its field. Headless Chrome has no on-screen keyboard: re-shoot on the iOS Simulator to show the rise.",
        asset: {
          ...PHONE,
          src: "footage/keyboard-sheet",
          alt: "A sheet on a phone with text being typed into its field.",
        },
      },
      {
        label: "B",
        line: "Composition: a real screenshot of the sheet, sitting on a drawn keyboard.",
        asset: {
          src: "stills/keyboard-compo",
          width: 1600,
          height: 1250,
          alt: "A phone with a sheet resting on top of the keyboard.",
        },
      },
    ],
  },
  {
    title: "Edge to edge, inside the safe areas",
    body: "The framework owns the insets and the scroll, so content never slides under the notch or drags the page.",
    current: <SafeAreasDiagram />,
    variants: [
      {
        label: "A",
        line: "Footage: the playground's lab list flung by a finger; it scrolls inside its own frame, clear of the island.",
        asset: {
          ...PHONE,
          src: "footage/safe-list",
          alt: "A long list flung up and down on a phone.",
        },
      },
      {
        label: "B",
        line: "Composition: the two insets adaptv owns, lit up on a real screen.",
        asset: {
          src: "stills/safe-compo",
          width: 1600,
          height: 1250,
          alt: "A phone with its top and bottom safe areas highlighted.",
        },
      },
    ],
  },
  {
    title: "Mistakes stop at build time",
    body: "Code that cannot run inside an app fails the build, not your users.",
    current: <BuildGuardDiagram />,
    variants: [
      {
        label: "A",
        line: "Replay: a file importing a server-only API, and the build's real refusal, word for word.",
        asset: {
          src: "footage/guard-cli",
          width: 1400,
          height: 900,
          video: true,
          alt: "An editor and a terminal: the build fails because a file imports a server-only API.",
        },
      },
      {
        label: "B",
        line: "Composition: the file and the refusal as two panes in space, over the rendered mesh.",
        asset: {
          src: "stills/guard-3d",
          width: 2000,
          height: 1250,
          alt: "A code pane and an error pane floating over a dark gradient.",
        },
      },
    ],
  },
]

const MATERIALS: { line: string; asset: LabAsset }[] = [
  {
    line: "Aurora loop: the hero's light as a rendered WebGL shader, 10 s, seamless.",
    asset: {
      src: "art/aurora",
      width: 1600,
      height: 900,
      video: true,
      alt: "Slowly drifting curtains of indigo, violet and pink light.",
    },
  },
  {
    line: "Mesh: a still colour field with grain, a backdrop for a card.",
    asset: {
      src: "art/mesh",
      width: 1600,
      height: 1000,
      alt: "A dark gradient with soft indigo, violet and pink pools.",
    },
  },
]

function Tag({
  children,
  current,
}: {
  children: ReactNode
  current?: boolean
}) {
  return (
    <span
      className={cn(
        "grid h-7 min-w-7 place-items-center rounded-full px-2.5 font-semibold text-[13px]",
        current ? "bg-sunken text-subtle" : "bg-brand text-brand-foreground",
      )}
    >
      {children}
    </span>
  )
}

function Caption({ tag, line }: { tag: ReactNode; line: string }) {
  return (
    <View row className="mb-3 items-start gap-3">
      {tag}
      <p className="pt-0.5 text-[14px] text-subtle leading-normal">{line}</p>
    </View>
  )
}

function Group({
  title,
  note,
  children,
}: {
  title: string
  note: string
  children: ReactNode
}) {
  return (
    <section className="flex flex-col gap-6 border-border border-t pt-10">
      <View className="gap-2">
        <h2 className="font-semibold text-[26px] tracking-[-0.02em]">
          {title}
        </h2>
        <p className="max-w-2xl text-[15px] text-muted">{note}</p>
      </View>
      {children}
    </section>
  )
}

function HardPartsCard({ spec }: { spec: CardSpec }) {
  //the landing's own grid: a wide card takes the row, two small cards share one
  const grid = spec.wide ? "" : "md:grid-cols-2"
  return (
    <View className="gap-4">
      <h3 className="font-medium text-[18px]">{spec.title}</h3>
      <div className={cn("grid grid-cols-1 gap-6", grid)}>
        <div>
          <Caption
            tag={<Tag current>Current</Tag>}
            line="The inline SVG diagram on the landing today."
          />
          <Card
            small={!spec.wide}
            visual={spec.current}
            title={spec.title}
            body={spec.body}
          />
        </div>
        {spec.variants.map((v) => (
          <div key={v.label}>
            <Caption tag={<Tag>{v.label}</Tag>} line={v.line} />
            <Card
              small={!spec.wide}
              visual={
                <div className="w-full overflow-hidden rounded-[var(--radius-tile)]">
                  <LabMedia asset={v.asset} />
                </div>
              }
              title={spec.title}
              body={spec.body}
            />
          </div>
        ))}
      </div>
    </View>
  )
}

function LabVisuals() {
  return (
    <SitePage>
      <View className="mx-auto w-full max-w-[1280px] gap-14 px-4 py-14 md:px-10">
        <View className="gap-3">
          <p className="font-mono text-[13px] text-muted">lab / visuals</p>
          <h1 className="font-semibold text-[clamp(2rem,1.2rem+2.6vw,3rem)] leading-[1.08] tracking-[-0.035em]">
            Landing visuals: assets instead of CSS
          </h1>
          <p className="max-w-2xl text-[16px] text-subtle leading-relaxed">
            For each landing section drawn in CSS: what ships today, then
            variations made from real footage of adaptv&apos;s own apps and from
            art rendered in headless Chrome. Videos load when they scroll near
            and play only on screen; with reduced motion you see their first
            frame. Not linked from the site.
          </p>
        </View>

        <Group
          title="Hero"
          note="The showcase under the headline. Today: Tally, a budget app drawn in HTML and CSS, over a CSS blur."
        >
          <div>
            <Caption
              tag={<Tag current>Current</Tag>}
              line="The CSS-drawn Tally in a window and on a phone."
            />
            <div className="flex justify-center overflow-hidden rounded-[var(--radius-card-sm)] bg-background px-5 pb-16 md:rounded-[var(--radius-card)]">
              <DeviceStage />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            {HERO.map((v) => (
              <div
                key={v.label}
                className={cn(v.label === "A" && "lg:col-span-2")}
              >
                <Caption tag={<Tag>{v.label}</Tag>} line={v.line} />
                <div className="overflow-hidden rounded-[var(--radius-card-sm)] md:rounded-[var(--radius-card)]">
                  <LabMedia asset={v.asset} />
                </div>
              </div>
            ))}
          </div>
        </Group>

        <Group
          title="The hard parts are already decided"
          note="Five cards, each with an inline SVG diagram today. Every variation is shown inside the real card, with its real title and body."
        >
          {HARD_PARTS.map((spec) => (
            <HardPartsCard key={spec.title} spec={spec} />
          ))}
        </Group>

        <Group
          title="Raw materials"
          note="Rendered backdrops the variations above are built on, usable on their own. The platform-marks row and the four-tools comparison are text and marks, not graphics, so they have no variations here."
        >
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            {MATERIALS.map((m) => (
              <div key={m.asset.src}>
                <p className="mb-3 text-[14px] text-subtle">{m.line}</p>
                <div className="overflow-hidden rounded-[var(--radius-card-sm)]">
                  <LabMedia asset={m.asset} />
                </div>
              </div>
            ))}
          </div>
        </Group>
      </View>
    </SitePage>
  )
}
