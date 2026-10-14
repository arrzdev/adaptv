import type { ReactNode } from "react"
import { AndroidPhone, IPhone, Lines, Phone, Wire } from "@/components/drawings"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"

/** Expo: a phone screen built from native blocks, and two more blocks on their way in. */
function NativeBlocks() {
  const blocks = [
    { x: 140, y: 38, w: 52, h: 22 },
    { x: 140, y: 66, w: 52, h: 40 },
    { x: 140, y: 112, w: 24, h: 24 },
    { x: 168, y: 112, w: 24, h: 24 },
    { x: 140, y: 142, w: 52, h: 18 },
  ]
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true" className="h-full w-full">
      <Phone x={128} y={20} w={76} h={160} />
      {blocks.map((b) => (
        <rect
          key={`${b.x},${b.y}`}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={5}
          className="fill-raised stroke-border-strong"
          strokeWidth={1.2}
        />
      ))}
      <rect
        x={76}
        y={58}
        width={30}
        height={30}
        rx={6}
        className="fill-brand-soft stroke-brand"
        strokeWidth={1.2}
      />
      <rect
        x={226}
        y={108}
        width={36}
        height={22}
        rx={6}
        className="fill-brand-soft stroke-brand"
        strokeWidth={1.2}
      />
    </svg>
  )
}

/** Ionic: a web page dressed in an app theme: a coloured toolbar, themed rows and tabs. */
function ThemedPage() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true" className="h-full w-full">
      <rect
        x={60}
        y={20}
        width={200}
        height={160}
        rx={10}
        className="fill-surface stroke-border-strong"
        strokeWidth={1.5}
      />
      <line
        x1={60}
        x2={260}
        y1={40}
        y2={40}
        className="stroke-border-strong"
        strokeWidth={1.5}
      />
      {[0, 1, 2].map((i) => (
        <circle
          key={i}
          cx={72 + i * 10}
          cy={30}
          r={3}
          className="fill-border-strong"
        />
      ))}
      <rect x={61} y={41} width={198} height={24} className="fill-brand" />
      <rect
        x={74}
        y={50}
        width={60}
        height={6}
        rx={3}
        className="fill-brand-foreground"
      />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <circle
            cx={84}
            cy={84 + i * 22}
            r={6}
            className="fill-brand-soft stroke-brand"
            strokeWidth={1}
          />
          <rect
            x={98}
            y={81 + i * 22}
            width={[110, 80, 96][i]}
            height={6}
            rx={3}
            className="fill-border-strong"
          />
        </g>
      ))}
      <line
        x1={60}
        x2={260}
        y1={152}
        y2={152}
        className="stroke-border"
        strokeWidth={1}
      />
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={88 + i * 40}
          y={161}
          width={24}
          height={8}
          rx={4}
          className={i === 0 ? "fill-brand" : "fill-border-strong"}
        />
      ))}
    </svg>
  )
}

/** adaptv: one web page that takes the shape of each platform it lands on. */
function PageTakesShape() {
  return (
    <svg viewBox="0 0 320 200" aria-hidden="true" className="h-full w-full">
      <Wire d="M112 88H170" />
      <Wire d="M112 100C140 100 140 172 170 172H259Q273 172 273 158V150" />
      <g>
        <rect
          x={16}
          y={44}
          width={96}
          height={88}
          rx={8}
          className="fill-surface stroke-border-strong"
          strokeWidth={1.5}
        />
        <line
          x1={16}
          x2={112}
          y1={58}
          y2={58}
          className="stroke-border-strong"
          strokeWidth={1.5}
        />
        <Lines
          x={28}
          y={70}
          w={72}
          widths={[0.9, 0.6, 0.8, 0.5]}
          gap={14}
          size={5}
        />
      </g>
      <IPhone x={170} y={26} w={58} h={124} />
      <AndroidPhone x={244} y={26} w={58} h={124} />
    </svg>
  )
}

const TOOLS: {
  name: string
  text: string
  drawing: ReactNode
  label: string
}[] = [
  {
    name: "Expo (React Native)",
    text: "Renders real native views. Excellent native feel and a large ecosystem. The trade: you leave the web platform. Web support exists, but the web is not where it starts.",
    drawing: <NativeBlocks />,
    label: "A phone screen built from native building blocks.",
  },
  {
    name: "Ionic",
    text: "Builds apps with web technology on top of Capacitor, with ready-made iOS and Material themes. The trade: you adopt its own components and look.",
    drawing: <ThemedPage />,
    label: "A web page dressed in an app theme.",
  },
  {
    name: "adaptv",
    text: "Plain React and CSS on the web platform, with Capacitor for the native parts — the same native bridge Ionic uses. The web is the primary target, and the framework handles what each platform expects, so you don't need a second app.",
    drawing: <PageTakesShape />,
    label:
      "One web page that takes the shape of an iPhone and of an Android phone.",
  },
]

/**
 * How it compares: three tools, three equal cards in one look, each naming the other
 * tool's real strength first. No table of checkmarks and no winner: the cards differ only
 * in what they say and draw.
 */
export function HowItCompares() {
  return (
    <Section
      eyebrow="How it compares"
      title="Good tools exist. adaptv picks a different trade."
    >
      <Reveal className="flex flex-col gap-8">
        <ul className="grid gap-4 md:grid-cols-3">
          {TOOLS.map((tool) => (
            <li
              key={tool.name}
              className="flex flex-col overflow-hidden rounded-3xl border border-border bg-surface"
            >
              <div className="dots border-border border-b p-6">
                <div
                  role="img"
                  aria-label={tool.label}
                  className="mx-auto aspect-[16/10] w-full max-w-[320px]"
                >
                  {tool.drawing}
                </div>
              </div>
              <div className="flex flex-col gap-2 p-6">
                <h3 className="font-semibold text-[18px] tracking-[-0.02em]">
                  {tool.name}
                </h3>
                <p className="text-[14.5px] text-muted leading-relaxed">
                  {tool.text}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-muted">
          adaptv is pre-alpha and not yet on npm.
        </p>
      </Reveal>
    </Section>
  )
}
