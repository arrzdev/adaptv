import { View } from "@arrzdev/adaptv/components"
import {
  Chrome,
  Compass,
  Download,
  Monitor,
  Play,
  Smartphone,
} from "lucide-react"

const TARGETS = [
  { icon: Monitor, name: "Desktop web", detail: "any browser" },
  { icon: Compass, name: "iOS Safari", detail: "mobile web" },
  { icon: Chrome, name: "Android Chrome", detail: "mobile web" },
  { icon: Download, name: "Home screen", detail: "installed PWA" },
  { icon: Smartphone, name: "App Store", detail: "native iOS" },
  { icon: Play, name: "Google Play", detail: "native Android" },
] as const

/** Where a logo wall would go. adaptv has no logos yet; it has six places it runs. */
export function Targets() {
  return (
    <section className="sheet ruled">
      <View className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
        {TARGETS.map(({ icon: Icon, name, detail }, index) => (
          <View key={name} className="gap-3 bg-background px-6 py-7">
            <View row className="items-center justify-between text-muted">
              <Icon className="size-5 text-foreground" strokeWidth={1.75} />
              <span className="font-mono text-[10.5px]">0{index + 1}</span>
            </View>
            <View className="gap-0.5">
              <span className="font-medium text-[14.5px]">{name}</span>
              <span className="font-mono text-[11.5px] text-muted">
                {detail}
              </span>
            </View>
          </View>
        ))}
      </View>
    </section>
  )
}
