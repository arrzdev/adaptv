import { View } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import { Check, WifiOff } from "lucide-react"
import type { ReactNode } from "react"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"

function MiniPhone({ children }: { children: ReactNode }) {
  return (
    <View className="relative h-[230px] w-[126px] overflow-hidden rounded-[26px] border-[3px] border-border-strong bg-background">
      {children}
    </View>
  )
}

function Hatch({ className }: { className?: string }) {
  return (
    <span
      className={cn("absolute inset-x-0 border-brand/60", className)}
      style={{
        backgroundImage:
          "repeating-linear-gradient(135deg, color-mix(in oklab, var(--brand) 45%, transparent) 0 2px, transparent 2px 7px)",
      }}
    />
  )
}

function SafeAreaArt() {
  return (
    <View row className="items-center gap-8">
      <MiniPhone>
        <Hatch className="top-0 h-9 border-b" />
        <span className="absolute top-2 left-1/2 h-3.5 w-10 -translate-x-1/2 rounded-full bg-foreground" />
        <View className="absolute inset-x-3 top-12 gap-2">
          <span className="h-2.5 w-2/3 rounded-full bg-foreground/80" />
          <span className="h-2 w-full rounded-full bg-border-strong" />
          <span className="h-2 w-5/6 rounded-full bg-border-strong" />
          <span className="h-2 w-3/4 rounded-full bg-border-strong" />
        </View>
        <Hatch className="bottom-0 h-6 border-t" />
        <span className="absolute bottom-2 left-1/2 h-1 w-12 -translate-x-1/2 rounded-full bg-foreground" />
      </MiniPhone>
      <View className="gap-2 font-mono text-[12px] text-muted">
        <span>
          {"<View "}
          <span className="text-brand">safe</span>
          {'="top">'}
        </span>
        <span>
          {"<View "}
          <span className="text-brand">safe</span>
          {'="bottom">'}
        </span>
        <span className="pt-2 text-[11px]">resolved before first paint</span>
      </View>
    </View>
  )
}

function KeyboardArt() {
  return (
    <MiniPhone>
      <View className="absolute inset-x-3 top-6 gap-2">
        <span className="h-6 w-3/4 self-start rounded-2xl rounded-bl-md bg-border-strong" />
        <span className="h-6 w-2/3 self-end rounded-2xl rounded-br-md bg-brand" />
        <span className="h-6 w-1/2 self-start rounded-2xl rounded-bl-md bg-border-strong" />
      </View>
      <View className="absolute inset-x-0 bottom-0">
        <View
          row
          className="mx-2 mb-1.5 h-7 items-center rounded-full border border-brand px-2.5"
        >
          <span className="caret h-3 w-px bg-brand" />
        </View>
        <View className="gap-1 bg-sunken p-1.5 pb-4">
          {[10, 9, 7].map((keys) => (
            <View key={keys} row className="justify-center gap-[3px]">
              {Array.from({ length: keys }, (_, key) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: decorative keys
                  key={key}
                  className="h-4 w-[9px] rounded-[3px] bg-border-strong"
                />
              ))}
            </View>
          ))}
        </View>
      </View>
    </MiniPhone>
  )
}

function OfflineArt() {
  return (
    <View className="w-full max-w-[300px] gap-2.5">
      <View
        row
        className="items-center gap-2.5 rounded-xl border border-border bg-raised px-4 py-3 text-[13.5px]"
      >
        <WifiOff className="size-4 text-danger" />
        No connection
        <span className="ml-auto font-mono text-[11px] text-muted">00:42</span>
      </View>
      {["App shell", "Your routes", "Images and fonts"].map((label) => (
        <View
          key={label}
          row
          className="items-center gap-2.5 px-4 text-[13.5px] text-subtle"
        >
          <Check className="size-4 text-success" strokeWidth={2.5} />
          {label}
          <span className="ml-auto font-mono text-[11px] text-muted">
            on device
          </span>
        </View>
      ))}
    </View>
  )
}

function UpdateArt() {
  return (
    <View className="w-full max-w-[300px] gap-4">
      <View row className="items-center justify-between font-mono text-[12px]">
        <span className="rounded-md bg-sunken px-2 py-1 text-muted">
          v1.4.1
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-border-strong to-brand" />
        <span className="rounded-md bg-brand px-2 py-1 text-brand-foreground">
          v1.4.2
        </span>
      </View>
      <View className="gap-2 rounded-xl border border-border bg-raised p-4 text-[13px]">
        {[
          ["Signed with your key", true],
          ["Verified on the device", true],
          ["Applied on next launch", true],
        ].map(([label]) => (
          <View
            key={String(label)}
            row
            className="items-center gap-2.5 text-subtle"
          >
            <Check className="size-4 text-success" strokeWidth={2.5} />
            {label}
          </View>
        ))}
      </View>
      <span className="text-center font-mono text-[11px] text-muted">
        no store review · self-hosted
      </span>
    </View>
  )
}

const CARDS = [
  {
    title: "Safe areas, on the first frame",
    line: "The notch and the home bar are a prop. No env() math, no header that jumps a frame late.",
    Art: SafeAreaArt,
  },
  {
    title: "One keyboard, every platform",
    line: "Three different OS signals become one. Inputs ride above the keys and the caret stays in view.",
    Art: KeyboardArt,
  },
  {
    title: "Works offline",
    line: "A service worker you never write. The installed app opens with no network, like an app should.",
    Art: OfflineArt,
  },
  {
    title: "Ship fixes over the air",
    line: "Push a signed JavaScript update to installed native apps from your own server.",
    Art: UpdateArt,
  },
] as const

export function Platform() {
  return (
    <Section
      index="03"
      eyebrow="Platform"
      title={
        <>
          The boring parts,
          <br />
          already done.
        </>
      }
      lede="Every team that wraps a web app rebuilds the same four things, badly, in month three. They ship in the box."
    >
      <View className="grid gap-4 md:grid-cols-2">
        {CARDS.map(({ title, line, Art }, index) => (
          <Reveal key={title} delay={(index % 2) * 0.06}>
            <View className="h-full overflow-hidden rounded-3xl border border-border bg-surface">
              <View className="dots min-h-[300px] flex-1 items-center justify-center p-8">
                <Art />
              </View>
              <View className="gap-1.5 border-border border-t p-6">
                <span className="font-medium text-[16px] tracking-tight">
                  {title}
                </span>
                <span className="text-[14px] text-muted leading-relaxed">
                  {line}
                </span>
              </View>
            </View>
          </Reveal>
        ))}
      </View>
    </Section>
  )
}
