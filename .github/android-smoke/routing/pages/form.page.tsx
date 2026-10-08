import { View } from "adaptv/components"
import { createFileRoute } from "adaptv/router"
import { useState } from "react"

export const Route = createFileRoute("/form")({
  component: Form,
})

//The echo line is what the smoke reads back: the WebView's accessibility tree carries
//its text, so a keystroke that reached the input shows up in `uiautomator dump`.
function Form() {
  const [value, setValue] = useState("")
  return (
    <View fill className="gap-4 p-safe-offset-6">
      <h1 className="font-semibold text-2xl">smoke form</h1>
      <input
        id="smoke-input"
        aria-label="smoke input"
        className="rounded-lg border px-4 py-3"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <p>echo:{value}</p>
    </View>
  )
}
