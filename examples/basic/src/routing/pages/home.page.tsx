import { View } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"

export const Route = createFileRoute("/")({
  component: Home,
})

//A route's root is a View: the frame around it is adaptv's, on every target.
function Home() {
  return (
    <View fill center className="home">
      <h1>basic</h1>
      <p>Edit src/routing/pages/home.page.tsx and save.</p>
    </View>
  )
}
