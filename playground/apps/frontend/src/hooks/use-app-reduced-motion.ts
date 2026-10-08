import { useReducedMotion as useSystemReducedMotion } from "adaptv/hooks"
import { useSettings } from "@/data/collections/preferences/settings"

export function useAppReducedMotion(): boolean {
  const systemReduced = useSystemReducedMotion()
  const { settings } = useSettings()
  return systemReduced || !settings.animations
}
