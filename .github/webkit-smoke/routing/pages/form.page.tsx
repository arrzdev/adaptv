import { View } from "adaptv/components"
import { createFileRoute } from "adaptv/router"
import { useState } from "react"

export const Route = createFileRoute("/form")({
  component: Form,
})

//The echo line is what the smoke reads back: a keystroke that reached the input shows up
//as `echo:<text>`, which phone.smoke.ts waits for.
function Form() {
  const [value, setValue] = useState("")
  return (
    <View fill>
      <h1>smoke form</h1>
      <input
        id="smoke-input"
        aria-label="smoke input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <p>echo:{value}</p>
    </View>
  )
}
