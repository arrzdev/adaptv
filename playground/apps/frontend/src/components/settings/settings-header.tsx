import { Text, View } from "@arrzdev/adaptv/components"
import { useRouter } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"
import { IconButton } from "@/components/ui"

export function SettingsHeader() {
  const router = useRouter()

  //explicit smartBack: pop when there's history to pop, else land on tasks. the
  //IconButton fires its own light tap haptic on press
  function handleBack() {
    if (router.history.canGoBack()) router.history.back()
    else router.navigate({ to: "/" })
  }

  return (
    <View row className="flex shrink-0 items-center gap-x-2">
      <IconButton
        onClick={handleBack}
        aria-label="Back to tasks"
        className="size-auto bg-transparent text-foreground hover:bg-transparent"
      >
        <ChevronLeft size={32} strokeWidth={1.75} aria-hidden />
      </IconButton>
      <Text
        // biome-ignore lint/a11y/useHeadingContent: the heading text flows through Text's render prop into the h1 at runtime (cloneElement), which the static check can't see
        render={<h1 />}
        className="min-w-0 truncate text-4xl font-semibold tracking-tight text-foreground"
      >
        Settings
      </Text>
    </View>
  )
}
