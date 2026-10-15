import { Link, View } from "adaptv/components"
import { Card } from "@/components/card"
import {
  BuildGuardDiagram,
  GesturesDiagram,
  KeyboardDiagram,
  SafeAreasDiagram,
  TargetsDiagram,
} from "@/components/diagram/diagrams"
import { Section } from "@/components/section"

/*
 * What makes adaptv different: it decides the dangerous parts for you. One decision per card,
 * each claim backed in the repo (landing-v4 §2.4):
 * - targets: README "What you get"
 * - gestures: docs/design/coordination.md, src/capabilities/gesture-controller.ts
 * - keyboard: docs/design/behaviors.md §4, src/hooks/use-freeze-viewport.ts
 * - safe areas: docs/VISION.md §1–2, src/shell/, src/components/scroll-view.tsx
 * - build guard: docs/design/server-boundary.md
 */
export function HardParts() {
  return (
    <Section
      title="The hard parts are already decided"
      lede="Gestures, scroll, the keyboard and safe areas behave the way each phone expects. You write the app."
    >
      <View className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card
          className="md:col-span-2"
          visual={<TargetsDiagram />}
          title="One React app on every screen"
          body="The same code deploys to the web, installs from the browser, and builds for iOS and Android."
          link={
            <Link
              to="/docs/$slug"
              params={{ slug: "six-targets" }}
              className="font-medium text-[15px] text-brand hover:underline"
            >
              See the targets ›
            </Link>
          }
        />
        <Card
          small
          visual={<GesturesDiagram />}
          title="One gesture at a time"
          body="One controller decides who owns each touch: the sheet, the back swipe or pull-to-refresh."
        />
        <Card
          small
          visual={<KeyboardDiagram />}
          title="The keyboard never hides the field"
          body="The page stays put, and the sheet rises with the keyboard instead."
        />
        <Card
          small
          visual={<SafeAreasDiagram />}
          title="Edge to edge, inside the safe areas"
          body="The framework owns the insets and the scroll, so content never slides under the notch or drags the page."
        />
        <Card
          small
          visual={<BuildGuardDiagram />}
          title="Mistakes stop at build time"
          body="Code that cannot run inside an app fails the build, not your users."
        />
      </View>
    </Section>
  )
}
