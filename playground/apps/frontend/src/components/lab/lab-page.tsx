import { EdgeSwipeGestures } from "@arrzdev/adaptv/components"
import { useMediaQuery } from "@arrzdev/adaptv/hooks"
import {
  getOS,
  isNativePlatform,
  isStandaloneDisplay,
} from "@arrzdev/adaptv/utils"
import { useRouter } from "@tanstack/react-router"
import { ChevronLeft } from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { LabBadge } from "@/components/lab/lab-kit"
import { PageWithSmoothEdges } from "@/components/page"
import { IconButton } from "@/components/ui"
import { useAppVibrate } from "@/hooks/use-app-vibrate"

/**
 * Shell for every lab page: the same header, the same back target, and a strip
 * that names the target you are looking at.
 *
 * The strip is not decoration. The lab exists to be opened on six different
 * runtimes and compared, and a screenshot with no target label is worthless —
 * so every page identifies itself.
 */
export function LabPage({
  title,
  subtitle,
  backTo = "/lab",
  children,
}: {
  title: string
  subtitle?: ReactNode
  backTo?: string
  children: ReactNode
}) {
  const router = useRouter()
  const isStandalone = useMediaQuery("(display-mode: standalone)")
  const { hapticPointerHandlers } = useAppVibrate()

  const backHandlers = hapticPointerHandlers(() => {
    if (router.history.canGoBack()) router.history.back()
    else router.navigate({ to: backTo })
  }, "ok")

  return (
    <PageWithSmoothEdges>
      <EdgeSwipeGestures
        enabled={isStandalone}
        left={() => router.navigate({ to: backTo })}
      />
      <header className="flex shrink-0 flex-col gap-y-2">
        <div className="flex items-center gap-x-2">
          <IconButton
            onClick={backHandlers.onClick}
            aria-label="Back to Testing"
            className="size-auto bg-transparent text-foreground hover:bg-transparent"
          >
            <ChevronLeft size={32} strokeWidth={1.75} aria-hidden />
          </IconButton>
          <h1 className="min-w-0 truncate text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
        </div>
        {subtitle && <p className="ps-1 text-sm text-muted">{subtitle}</p>}
        <TargetStrip />
      </header>
      {children}
    </PageWithSmoothEdges>
  )
}

/** Which of the six targets is this? Resolved on the client only. */
export function TargetStrip() {
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    const shell = isNativePlatform()
      ? "native"
      : isStandaloneDisplay()
        ? "standalone PWA"
        : "browser tab"
    setTarget(`${shell} · ${getOS()}`)
  }, [])

  return (
    <div className="ps-1">
      <LabBadge tone="muted">{target ?? "resolving target…"}</LabBadge>
    </div>
  )
}
