import { Button, Text, View } from "adaptv/components"
import { useState } from "react"

const BODY =
  "The ferry leaves at six. If you miss it there is a second one at nine, but it stops at every island on the way and the café on board closes before it sails. Bring a jacket: the upper deck is the only place with a view, and it is always colder than the forecast says."

export function TextDemo() {
  const [clamped, setClamped] = useState(true)
  return (
    <View className="w-full max-w-sm gap-3">
      <View className="rounded-xl border border-border bg-raised p-4">
        <Text
          render={<p />}
          selectable
          numberOfLines={clamped ? 2 : undefined}
          className="text-[15px] text-foreground leading-relaxed"
        >
          {BODY}
        </Text>
      </View>
      <Button
        onClick={() => setClamped((value) => !value)}
        className="self-start rounded-lg bg-sunken px-3 py-1.5 text-[13px] text-foreground active:scale-95"
      >
        <Button.Text>
          {clamped ? "Show every line" : "Clamp to 2 lines"}
        </Button.Text>
      </Button>
    </View>
  )
}
