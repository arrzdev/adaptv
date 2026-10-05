import { View } from "@arrzdev/adaptv/components"
import { CodePanel } from "@/components/code"
import { PhoneFrame } from "@/components/frames"
import { Recording } from "@/components/recording"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"
import { type Clip, RECORDINGS, SHOW_DRAFTS } from "@/content/recordings"
//the files themselves, not copies: they run on the playground's /lab/landing page,
//which is where the clips are recorded, and its typecheck keeps them compiling
import replyForm from "../../../../playground/apps/frontend/src/components/landing/reply-form.tsx?raw"
import saveButton from "../../../../playground/apps/frontend/src/components/landing/save-button.tsx?raw"
import shareButton from "../../../../playground/apps/frontend/src/components/landing/share-button.tsx?raw"

type Feature = {
  label: string
  file: string
  code: string
  clip: Clip | null
  shows: string
}

const FEATURES: Feature[] = [
  {
    label: "Haptics",
    file: "save-button.tsx",
    code: saveButton,
    clip: RECORDINGS.haptics,
    shows: "A tap on Save on a phone, and the save it records",
  },
  {
    label: "Share",
    file: "share-button.tsx",
    code: shareButton,
    clip: RECORDINGS.share,
    shows: "A tap on Share opening the phone's share sheet",
  },
  {
    label: "Keyboard",
    file: "reply-form.tsx",
    code: replyForm,
    clip: RECORDINGS.keyboard,
    shows: "The bottom field staying above the keyboard as it opens",
  },
]

export function NativeFeatures() {
  const ready = FEATURES.every((feature) => feature.clip)
  if (!ready && !SHOW_DRAFTS) return null
  return (
    <Section
      title="Native features from plain React"
      lede="Haptics, the share sheet and the keyboard work the same on every target."
    >
      <ul className="grid gap-6 md:grid-cols-3">
        {FEATURES.map((feature, index) => (
          <li key={feature.label} className="flex min-w-0">
            <Reveal
              duration={0.2}
              delay={index * 0.06}
              className="flex min-w-0 flex-1 flex-col gap-5"
            >
              <h3 className="font-semibold text-[19px] tracking-[-0.02em]">
                {feature.label}
              </h3>
              <CodePanel
                samples={[
                  { label: feature.file, lang: "tsx", code: feature.code },
                ]}
                className="min-w-0 flex-1"
              />
              <View className="mx-auto w-[60%] max-w-[220px] md:w-[220px]">
                <PhoneFrame recording>
                  <Recording clip={feature.clip} label={feature.shows} />
                </PhoneFrame>
              </View>
            </Reveal>
          </li>
        ))}
      </ul>
    </Section>
  )
}
