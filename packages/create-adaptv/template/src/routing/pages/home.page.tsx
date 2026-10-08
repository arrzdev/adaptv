import { View } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"

export const Route = createFileRoute("/")({
  component: Home,
})

//A route's root is a View: the frame around it is adaptv's, on every target.
function Home() {
  return (
    <View fill center className="gap-2 p-safe-offset-6 text-center">
      <h1 className="font-semibold text-2xl">__NAME__</h1>
      <p className="opacity-60">
        Edit src/routing/pages/home.page.tsx and save.
      </p>
    </View>
  )
}
