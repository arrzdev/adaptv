import { Link, View } from "adaptv/components"
import { createFileRoute } from "adaptv/router"

export const Route = createFileRoute("/")({
  component: Home,
})

function Home() {
  return (
    <View fill center className="gap-4 p-safe-offset-6 text-center">
      <h1 className="font-semibold text-2xl">smoke home</h1>
      <Link to="/form" className="rounded-lg border px-6 py-3">
        open form
      </Link>
    </View>
  )
}
