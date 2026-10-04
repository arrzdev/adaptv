import { ScrollView, View } from "@arrzdev/adaptv/components"
import { PhoneFrame } from "@/components/frames"
import { DEMO_ROWS, DemoAvatar, DemoHeader } from "./demo-rows"

function Rows() {
  return (
    <>
      {DEMO_ROWS.map(([name, text], index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: static demo content
          key={index}
          className="flex items-center gap-3 border-border border-b px-4 py-2.5"
        >
          <DemoAvatar name={name} />
          <div className="min-w-0">
            <div className="font-medium text-[12.5px]">{name}</div>
            <div className="truncate text-muted text-[11.5px]">{text}</div>
          </div>
        </div>
      ))}
    </>
  )
}

/**
 * Scroll each inbox past its end. On the left the gesture escapes to the page you are
 * reading; on the right it stops where the list does. Works with a wheel or a finger.
 */
export function OverscrollDemo() {
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
            <Rows />
          </div>
        </div>
      </PhoneFrame>
      <PhoneFrame label="adaptv" tone="good" className="w-[47%] max-w-[270px]">
        <View className="h-full">
          <DemoHeader title="Inbox" />
          <ScrollView fill>
            <Rows />
          </ScrollView>
        </View>
      </PhoneFrame>
    </View>
  )
}
