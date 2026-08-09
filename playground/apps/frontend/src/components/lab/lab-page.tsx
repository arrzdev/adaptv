import { EdgeSwipeGestures } from "@arrzdev/adaptv/components"
import { useRouter } from "@arrzdev/adaptv/router"
import {
  getOS,
  isNativePlatform,
  isStandaloneDisplay,
} from "@arrzdev/adaptv/utils"
import { ChevronLeft } from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { LabBadge } from "@/components/lab/lab-kit"
import { PageWithSmoothEdges } from "@/components/page"
import { IconButton } from "@/components/ui"
import { useIsInstalledApp } from "@/hooks/use-installed-app"

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
  //Armed wherever the app is INSTALLED, matching the settings page. The lab runs on
  //the same shell as the rest of the app: once installed it boots on memory history
  //(`memoryHistoryInStandalone`), so there is no entry behind the page for the
  //platform's own back-forward swipe to reach and the chevron above is otherwise the
  //only way out. Off in a browser tab, where the browser's edge swipe already is
  //back and a second recogniser would pop twice. See useIsInstalledApp.
  const isInstalled = useIsInstalledApp()

  //the IconButton fires its own light tap haptic on press
  function handleBack() {
    if (router.history.canGoBack()) router.history.back()
    else router.navigate({ to: backTo })
  }

  return (
    <PageWithSmoothEdges>
      <EdgeSwipeGestures
        enabled={isInstalled}
        left={() => router.navigate({ to: backTo })}
      />
      <header className="flex shrink-0 flex-col gap-y-2">
        <div className="flex items-center gap-x-2">
          <IconButton
            onClick={handleBack}
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
