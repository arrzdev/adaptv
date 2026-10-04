import { Pressable, ScrollView, View } from "@arrzdev/adaptv/components"
import { PhoneFrame } from "@/components/frames"
import { DEMO_ROWS, DemoAvatar, DemoHeader } from "./demo-rows"

const ROW =
  "flex w-full items-center gap-3 border-border border-b px-4 py-2.5 text-left"

function RowBody({ name, text }: { name: string; text: string }) {
  return (
    <>
      <DemoAvatar name={name} />
      <span className="min-w-0">
        <span className="block font-medium text-[12.5px]">{name}</span>
        <span className="block truncate text-muted text-[11.5px]">{text}</span>
      </span>
    </>
  )
}

/**
 * Flick both lists with a finger. On the left every row you touch flashes, because
 * `:active` cannot tell a press from the start of a scroll. On the right nothing lights
 * until it is a press — and a press that turns into a scroll lets go.
 */
export function PressDemo() {
  return (
    <View row className="w-full items-start justify-center gap-4 sm:gap-12">
      <PhoneFrame
        label="Plain web view"
        tone="bad"
        className="w-[47%] max-w-[270px]"
      >
        <div className="flex h-full flex-col">
          <DemoHeader title="Inbox" />
          <div className="plain-scroll min-h-0 flex-1">
            {DEMO_ROWS.map(([name, text], index) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: static demo content
                key={index}
                type="button"
                className={`plain-press ${ROW}`}
              >
                <RowBody name={name} text={text} />
              </button>
            ))}
          </div>
        </div>
      </PhoneFrame>
      <PhoneFrame label="adaptv" tone="good" className="w-[47%] max-w-[270px]">
        <View className="h-full">
          <DemoHeader title="Inbox" />
          <ScrollView fill>
            {DEMO_ROWS.map(([name, text], index) => (
              <Pressable
                // biome-ignore lint/suspicious/noArrayIndexKey: static demo content
                key={index}
                className={`${ROW} active:bg-brand/20`}
              >
                <RowBody name={name} text={text} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </PhoneFrame>
    </View>
  )
}
