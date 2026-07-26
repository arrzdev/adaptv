import { useVibrate as useBaseVibrate } from "@arrzdev/adaptv/hooks"
import type { MouseEvent } from "react"
import { useCallback, useMemo } from "react"
import { useSettings } from "@/data/collections/preferences/settings"

type VibrateKind = "ok" | "success" | "cancel"
type AppVibrate = ReturnType<typeof useBaseVibrate>

function vibrateKind(base: AppVibrate, kind: VibrateKind) {
  if (kind === "ok") base.vibrateOk()
  else if (kind === "success") base.vibrateSuccess()
  else base.vibrateCancel()
}

export function useAppVibrate(): AppVibrate {
  const { settings } = useSettings()
  const base = useBaseVibrate()

  const hapticPointerHandlers = useCallback(
    (handler: () => void, kind: VibrateKind) => ({
      //override the base hook's touchend haptics: iOS only vibrates inside a real
      //click/user-activation, so haptics fire on onClick only (see haptics-click-only)
      onTouchEnd: () => {},
      onClick: (_e: MouseEvent<HTMLElement>) => {
        if (settings.haptics) vibrateKind(base, kind)
        handler()
      },
    }),
    [base, settings.haptics],
  )

  return useMemo((): AppVibrate => {
    if (settings.haptics) {
      return { ...base, hapticPointerHandlers }
    }

    return {
      vibrateOk: () => {},
      vibrateSuccess: () => {},
      vibrateCancel: () => {},
      vibrateSelection: () => {},
      vibrateImpact: () => {},
      vibrateWarning: () => {},
      vibrateError: () => {},
      canVibrate: () => false,
      hapticPointerHandlers: (handler: () => void) => ({
        //override the base hook's touchend haptics: iOS only vibrates inside a real
        //click/user-activation, so haptics fire on onClick only (see haptics-click-only)
        onTouchEnd: () => {},
        onClick: handler,
      }),
    }
  }, [base, hapticPointerHandlers, settings.haptics])
}
