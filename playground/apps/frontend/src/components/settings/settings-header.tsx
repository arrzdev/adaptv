import { useRouter } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"
import { IconButton } from "@/components/ui"
import { useAppVibrate } from "@/hooks/use-app-vibrate"

export function SettingsHeader() {
  const router = useRouter()
  const { hapticPointerHandlers } = useAppVibrate()

  //explicit smartBack: pop when there's history to pop, else land on tasks. fires
  //via the Button's onPressUp so the chevron gets the same swift press as the gear
  const backHandlers = hapticPointerHandlers(() => {
    if (router.history.canGoBack()) router.history.back()
    else router.navigate({ to: "/" })
  }, "ok")

  return (
    <header className="flex shrink-0 items-center gap-x-2">
      <IconButton
        onClick={backHandlers.onClick}
        aria-label="Back to tasks"
        className="size-auto bg-transparent text-foreground hover:bg-transparent"
      >
        <ChevronLeft size={32} strokeWidth={1.75} aria-hidden />
      </IconButton>
      <h1 className="min-w-0 truncate text-4xl font-semibold tracking-tight text-foreground">
        Settings
      </h1>
    </header>
  )
}
