import { Pressable } from "@arrzdev/adaptv/components"
import { createFileRoute } from "@arrzdev/adaptv/router"
import { LabBrief } from "@/components/lab/lab-brief"
import { LabCaveat, LabSection } from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"
import "@/routing/pages/lab/plain-css.css"

export const Route = createFileRoute("/_providers/lab/plain-css")({
  component: LabPlainCssPage,
})

function LabPlainCssPage() {
  return (
    <LabPage
      title="Plain CSS"
      subtitle="The hover: and active: corrections, reaching a stylesheet that never heard of Tailwind. The tiles below are styled by plain-css.css — `.tile:hover { … }`, `.press:active { … }` — and adaptv rewrites those rules in the emitted CSS."
    >
      <LabBrief
        what="That a hand-written :hover rule does not stick after a tap, and a hand-written :active rule on an adaptv Pressable follows the gesture engine — with no Tailwind class anywhere on the element."
        steps={[
          "Touch only: tap “tap me (plain CSS)” and lift. It must return to grey at once — no red left behind.",
          "Touch only: tap the tile inside the opt-out box. It may stay red: data-adaptv-no-hover gives that subtree stock :hover, sticky tap included. That is the hatch working.",
          "Hold “hold me (plain CSS :active)”. It must turn green while held, go grey when your finger drags off it, green again when it slides back, grey on release.",
          "Mouse: hover both tiles. Both tint red while the pointer is over them.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "With a mouse every step that does not need a finger is observable; steps 1–2 need touch emulation or a touchscreen.",
          },
          pwa: { verdict: "works", note: "Same stylesheet, same rules." },
          ios: {
            verdict: "works",
            note: "(hover: hover) is false, so the rewritten :hover never applies; the press is the engine's reentrant data-pressed.",
          },
          android: {
            verdict: "works",
            note: "As iOS. A WebView with a mouse attached reports (hover: hover); a tint then is correct.",
          },
        }}
        wrong="The first tile stays red after a tap: the rewrite did not run on this stylesheet. The press tile stays green after the finger drags off: the :active rule was not routed to data-pressed."
      />

      <LabSection
        title="A :hover rule in plain CSS"
        description="`.plain-css-tile:hover { background: red }` — moved under @media (hover: hover) by the build, with adaptv's focus guard."
      >
        {/* a div, not a button: a tap focuses a button, and adaptv's focus guard
            would then hide the hover on its own — this tile isolates the media query */}
        <div className="plain-css-tile">tap me (plain CSS)</div>
      </LabSection>

      <LabSection
        title="The opt-out"
        description="The same rule, inside data-adaptv-no-hover. The hatch restores stock :hover for that subtree."
      >
        <div data-adaptv-no-hover="">
          <div className="plain-css-tile">tap me (opted out)</div>
        </div>
        <LabCaveat>
          Use the hatch for a surface whose hover state is meant to persist
          after a tap. Everything else is better off with the correction.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="An :active rule in plain CSS"
        description="`.plain-css-press:active { background: green }` on an adaptv Pressable. The build routes it to the engine's [data-pressed], which drops when the finger drags off."
      >
        <Pressable className="plain-css-press">
          hold me (plain CSS :active)
        </Pressable>
      </LabSection>
    </LabPage>
  )
}
