import { Link, View } from "adaptv/components"
import { createFileRoute } from "adaptv/router"

export const Route = createFileRoute("/")({
  component: Home,
})

function Home() {
  return (
    <View fill center>
      <h1>smoke home</h1>
      <Link to="/form">open form</Link>
    </View>
  )
}
