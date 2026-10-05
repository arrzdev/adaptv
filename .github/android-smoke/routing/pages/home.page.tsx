import { Link, View } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"

export const Route = createFileRoute("/")({
  component: Home,
})

function Home() {
  return (
    <View fill center safe="all" className="gap-4 p-6 text-center">
      <h1 className="font-semibold text-2xl">smoke home</h1>
      <Link to="/form" className="rounded-lg border px-6 py-3">
        open form
      </Link>
    </View>
  )
}
