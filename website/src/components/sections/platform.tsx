import { Link, View } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import { CodePanel, type CodeSample } from "@/components/code"
import { Reveal } from "@/components/reveal"
import { Section } from "@/components/section"

/*
 * Each fix next to the code that uses it. The snippets are trimmed from the docs page
 * each row links to, so a claim here never drifts from what the API really is.
 */
const ROWS: {
  title: string
  line: string
  docs: [slug: string, title: string]
  sample?: CodeSample
  /** For a fix with no code to show: how to see it. */
  tryIt?: string
}[] = [
  {
    title: "Safe areas, on the first frame",
    line: "The notch and the home bar are a prop. No env() math, no header that jumps a frame late.",
    docs: ["safe-areas", "Safe areas"],
    sample: {
      label: "settings.page.tsx",
      lang: "tsx",
      code: `<View>
  <View safe="top" className="px-4 pb-2">
    <Title />
  </View>

  <ScrollView className="px-4">{rows}</ScrollView>

  <View safe="bottom" className="border-t px-4 pt-3">
    <SaveButton />
  </View>
</View>`,
    },
  },
  {
    title: "One keyboard, every platform",
    line: "Three different OS signals become one. Inputs ride above the keys and the caret stays in view.",
    docs: ["keyboard", "The software keyboard"],
    sample: {
      label: "composer.tsx",
      lang: "tsx",
      code: `const { isOpen, height } = useKeyboard()

return (
  <View
    row
    className="absolute inset-x-0 bottom-0 gap-2 px-3 pt-2"
    style={{ paddingBottom: isOpen ? height + 8 : undefined }}
  >
    <Input placeholder="Message" className="flex-1" />
    <SendButton />
  </View>
)`,
    },
  },
  {
    title: "Works offline",
    line: "A service worker you never write. The installed app opens with no network, like an app should.",
    docs: ["offline", "Offline and the service worker"],
    tryIt: "Add to home screen, enable airplane mode, reopen.",
  },
  {
    title: "Ship fixes over the air",
    line: "Push a signed JavaScript update to installed native apps from your own server.",
    docs: ["ota-updates", "Over-the-air updates"],
    sample: {
      label: "Terminal",
      lang: "bash",
      code: `# once: print the signing key pair
adaptv keys ota

# every web deploy publishes the update
ADAPTV_OTA_PRIVATE_KEY=... adaptv build web`,
    },
  },
]

export function Platform() {
  return (
    <Section
      title="Safe areas, keyboard, offline, updates"
      lede="Teams that wrap a web app usually rebuild these four. They ship with adaptv."
    >
      <View className="gap-16 md:gap-20">
        {ROWS.map(({ title, line, docs, sample, tryIt }, index) => (
          <Reveal key={title}>
            <View className="grid items-center gap-6 lg:grid-cols-[1fr_1.4fr] lg:gap-14">
              <View
                className={cn("min-w-0 gap-2", index % 2 === 1 && "lg:order-2")}
              >
                <h3 className="font-semibold text-[22px] tracking-tight">
                  {title}
                </h3>
                <p className="text-[15.5px] text-subtle leading-relaxed">
                  {line}
                </p>
                <Link
                  to="/docs/$slug"
                  params={{ slug: docs[0] }}
                  className="self-start text-[14px] text-brand hover:underline"
                >
                  {docs[1]}
                </Link>
              </View>
              {sample ? (
                <CodePanel samples={[sample]} className="min-w-0" />
              ) : (
                <p className="text-[17px] leading-relaxed">{tryIt}</p>
              )}
            </View>
          </Reveal>
        ))}
      </View>
    </Section>
  )
}
