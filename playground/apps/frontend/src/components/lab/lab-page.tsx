import { EdgeSwipeGestures } from "@arrzdev/adaptv/components"
import { adaptvBack } from "@arrzdev/adaptv/hooks"
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
import { useSwipeBack } from "@/hooks/use-swipe-back"

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
  //a back press, not a navigation: an open drawer takes it first (useSwipeBack)
  const swipeBack = useSwipeBack(backTo)

  //The e2e seam for a back press. The real inputs are a hardware button and an OS
  //gesture, neither of which a headless browser has, and an on-page button cannot
  //stand in while a menu or a modal drawer is open: pressing it is an outside press
  //that dismisses the menu, and the drawer's overlay covers it. `adaptvBack()` is
  //the exact call the Android listener makes, so a spec presses back through it.
  useEffect(() => {
    ;(window as unknown as { __adaptvBack?: () => boolean }).__adaptvBack =
      adaptvBack
  }, [])

  //the IconButton fires its own light tap haptic on press
  function handleBack() {
    if (router.history.canGoBack()) router.history.back()
    else router.navigate({ to: backTo })
  }

  return (
    <PageWithSmoothEdges>
      <EdgeSwipeGestures enabled={isInstalled} left={swipeBack} />
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
        {/* a `div` for the same reason LabSection's description is one: it takes a node */}
        {subtitle && (
          <div className="ps-1 text-sm text-muted">{subtitle}</div>
        )}
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
