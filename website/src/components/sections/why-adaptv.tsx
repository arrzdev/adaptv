import { Feather, Globe, Layers } from "lucide-react"
import {
  AndroidPhone,
  DesktopBrowser,
  FileCard,
  IPhone,
  PhoneBrowser,
  Wire,
} from "@/components/drawings"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"

const POINTS = [
  {
    icon: Layers,
    lead: "One codebase.",
    line: "Desktop web, mobile web, an installable home-screen app, and iOS and Android apps.",
  },
  {
    icon: Feather,
    lead: "Feels native, not wrapped.",
    line: "Drawers, swipes, pull-to-refresh and keyboards behave the way each phone does.",
  },
  {
    icon: Globe,
    lead: "The web stays first.",
    line: "It is still the web: your CSS, your React libraries, your browser tools.",
  },
] as const

/*
 * Left to right: one React file, the lines that fan out of it, and the same app on four
 * screens, each with the detail that makes it at home there: the wide layout on a desktop,
 * the "Add to Home Screen" badge in a phone browser, a sheet on iOS, the back arrow on
 * Android. Each wire runs under the screens and rises into its own, so none crosses one.
 */
function Landscape() {
  const devices = [
    { x: 330, w: 280 },
    { x: 642, w: 88 },
    { x: 754, w: 88 },
    { x: 866, w: 88 },
  ]
  return (
    <svg
      viewBox="0 96 960 264"
      aria-hidden="true"
      className="hidden h-full w-full md:block"
    >
      {devices.map(({ x, w }, i) => {
        const from = 196 + i * 8
        const bus = 316 + i * 10
        const to = x + w / 2
        return (
          <Wire
            key={x}
            d={`M164 ${from}C230 ${from} 230 ${bus} 290 ${bus}H${to - 14}Q${to} ${bus} ${to} ${bus - 14}V300`}
          />
        )
      })}
      <FileCard x={24} y={133} w={140} h={150} />
      <DesktopBrowser x={330} y={110} w={280} h={190} />
      <PhoneBrowser x={642} y={110} w={88} h={190} />
      <IPhone x={754} y={110} w={88} h={190} />
      <AndroidPhone x={866} y={110} w={88} h={190} />
    </svg>
  )
}

/*
 * Top to bottom on a phone: the file, the three phones, the desktop window. The desktop's
 * wire drops through the gap between the first two phones.
 */
function Portrait() {
  return (
    <svg
      viewBox="0 0 360 640"
      aria-hidden="true"
      className="h-full w-full md:hidden"
    >
      <Wire d="M166 166C166 200 68 196 68 230" />
      <Wire d="M180 166V230" />
      <Wire d="M194 166C194 200 292 196 292 230" />
      <Wire d="M173 166C173 196 124 190 124 220V470" />
      <FileCard x={110} y={16} w={140} h={150} />
      <PhoneBrowser x={24} y={230} w={88} h={190} />
      <IPhone x={136} y={230} w={88} h={190} />
      <AndroidPhone x={248} y={230} w={88} h={190} />
      <DesktopBrowser x={24} y={470} w={312} h={154} />
    </svg>
  )
}

/**
 * Why adaptv: the problem it solves, as one drawing and three points. The drawing's box is
 * held by its aspect ratio before anything paints; its two orientations are two SVGs and
 * CSS shows one, so assistive tech meets a single image.
 */
export function WhyAdaptv() {
  return (
    <Section
      eyebrow="Why adaptv"
      title="One React app. At home on every screen."
      lede="Most teams build their app twice: once for the web, once for phones. Or they wrap a website in an app shell, and users can tell. adaptv lets you write your app once, in ordinary React, and gives each platform what it expects: the gestures, the sheets, the back button, the safe areas, the offline mode, the home-screen icon."
    >
      <Reveal>
        <div
          role="img"
          aria-label="One React file becomes the same app on a desktop browser, a phone browser, an iPhone and an Android phone."
          className="mx-auto aspect-[360/640] w-full max-w-[400px] md:aspect-[960/264] md:max-w-none"
        >
          <Portrait />
          <Landscape />
        </div>
      </Reveal>
      <Reveal>
        <ul className="grid gap-8 md:grid-cols-3">
          {POINTS.map(({ icon: Icon, lead, line }) => (
            <li key={lead} className="flex flex-col gap-3">
              <Icon className="size-5 text-brand" strokeWidth={1.75} />
              <p className="text-[15px] text-muted leading-relaxed">
                <strong className="font-semibold text-foreground">
                  {lead}
                </strong>{" "}
                {line}
              </p>
            </li>
          ))}
        </ul>
      </Reveal>
    </Section>
  )
}
