import { ScrollView, View } from "@arrzdev/adaptv/components"
import { useState } from "react"
import { LabBrief } from "@/components/lab/lab-brief"
import {
  LabActions,
  LabButton,
  LabCaveat,
  LabRow,
  LabSection,
} from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"

export const Route = createFileRoute({
  component: LabViewScrollPage,
})

//a fixed list, so every row has a real key
const ROWS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
] as const

const CARDS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const

const TILE = "rounded-md bg-secondary px-3 py-2 text-sm text-foreground"

function LabViewScrollPage() {
  const [scrollEnabled, setScrollEnabled] = useState(true)
  const [showBars, setShowBars] = useState(true)

  return (
    <LabPage
      title="View & ScrollView"
      subtitle="The two layout primitives. View is a flex column that never scrolls; ScrollView is the one that does, and it owns the scroll axis, contained overscroll and the edge fades."
    >
      <LabBrief
        what="That View lays out as a column by default and grows correctly with `fill`, and that ScrollView scrolls on exactly one axis, never bleeds into the other, and honours its prop switches live."
        steps={[
          "Scroll the vertical box. It must move; the page behind it must NOT start scrolling when you reach the end (overscroll is contained).",
          "Drag the horizontal strip diagonally — start sideways, then curve upward mid-drag. The strip must stay pinned to the horizontal, and a swipe that starts on it and goes straight up must scroll the PAGE.",
          "Park the deep-fade box at the very top and read the first line. It must be perfectly crisp — a fade there is the bug this was rebuilt to remove.",
          "Turn “scrollEnabled” off and try to scroll the vertical box. It must clip instead — content stays cut off, nothing moves.",
          "Turn the scroll indicators off and scroll again: no visible scrollbar, but the box still scrolls.",
          "Look at the fade box: content must dissolve into the background at the top and bottom edges, not stop against a hard line.",
        ]}
        expected={{
          web: {
            verdict: "partial",
            note: "Everything works. The axis lock is the browser\u2019s own, not adaptv\u2019s, so there is nothing here that can behave differently per target.",
          },
          pwa: {
            verdict: "partial",
            note: "Same as the browser tab, plus: with the default ui.hideScrollbars the indicators are gone whatever the showsVerticalScrollIndicator prop says, because the app-wide reset already removed them. Not a bug — check the App feel page.",
          },
          ios: {
            verdict: "works",
            note: "The target where contained overscroll matters most: the page must not rubber-band when an inner scroller hits its end. Also the only place to judge the fades against rubber-band \u2014 the strengths are clamped so an overscrolled edge cannot flicker opaque.",
          },
          android: {
            verdict: "partial",
            note: "Same as the web. Chromium's overscroll glow may show at the end of an inner scroller — that is the platform's own affordance, not scroll chaining.",
          },
        }}
        wrong="An inner scroller reaching its end starts scrolling the page underneath it (overscroll-behavior lost). The horizontal strip also scrolls vertically, or the vertical box also scrolls sideways — that is the single-axis pin gone, and it makes every list in the app wobble. scrollEnabled={false} still scrolls."
      />

      <LabSection
        title="View — the flex column"
        description="Column by default (RN parity), because a column is what a screen is. `row`, `center` and `fill` are props; everything cosmetic is className."
      >
        <View className="gap-y-2">
          <span className={TILE}>default — column</span>
          <span className={TILE}>second child, stacked below</span>
        </View>
        <View row className="gap-x-2">
          <span className={TILE}>row</span>
          <span className={TILE}>side</span>
          <span className={TILE}>by side</span>
        </View>
        <View
          center
          className="h-24 rounded-md bg-secondary text-sm text-foreground"
        >
          center — both axes
        </View>
        <LabRow
          label="fill"
          value="flex-1 + min-h-0"
          hint="The min-h-0 is the load-bearing half: without it a nested scroller inside a flex column refuses to shrink and the page grows instead of scrolling."
        />
      </LabSection>

      <LabSection
        title="ScrollView — vertical"
        description="Setting overflow on one axis forces the other from visible to auto, so a bare single-axis scroller silently becomes scrollable both ways. scrollable-y pins the cross axis to hidden and contains the overscroll."
      >
        <LabActions>
          <LabButton onClick={() => setScrollEnabled((on) => !on)}>
            scrollEnabled: {String(scrollEnabled)}
          </LabButton>
          <LabButton onClick={() => setShowBars((on) => !on)}>
            indicators: {String(showBars)}
          </LabButton>
        </LabActions>
        <LabCaveat>
          Two things here look broken and are not.{" "}
          <strong>
            The indicator toggle may show no difference on macOS
          </strong>{" "}
          — the OS uses overlay scrollbars, which are invisible until you
          scroll and fade straight back out, so{" "}
          <code>scrollbar-width: none</code> and <code>auto</code> render
          identically. Turn on{" "}
          <em>System Settings → Appearance → Show scroll bars: Always</em>,
          or use a mouse, to see it. It is applied either way: the class
          flips to <code>scrollbar-hidden</code> and the computed{" "}
          <code>scrollbar-width</code> to <code>none</code>.{" "}
          <strong>And the box still bounces at its own edges</strong>, on
          purpose. <code>overscroll-behavior: contain</code> stops the
          scroll CHAINING to the page behind it; it deliberately keeps the
          local rubber-band, because that is what a native scroller does.{" "}
          <code>none</code> would kill the bounce too. The thing to verify
          is that the page behind does not move — not that the box sits
          still.
        </LabCaveat>
        <ScrollView
          //a stable hook for the overscroll e2e — the page now has several h-40
          //scrollers and matching one on its utility classes breaks on a retune
          data-lab-scroller="vertical"
          scrollEnabled={scrollEnabled}
          showsVerticalScrollIndicator={showBars}
          className="h-40 rounded-md bg-secondary p-3"
        >
          {ROWS.map((row) => (
            <p key={row} className="py-1 text-sm text-foreground">
              Row {row} — scroll to the end, then keep pulling.
            </p>
          ))}
        </ScrollView>
      </LabSection>

      <LabSection
        title="ScrollView — horizontal"
        description="A horizontal scroller inside a vertical page. There is no lock prop and no lock code: the browser routes the axis itself, and adaptv's only job is to not get in the way — which it was, with a single-axis touch-action that made a vertical swipe starting here scroll nothing at all."
      >
        <ScrollView horizontal className="rounded-md bg-secondary p-3">
          <div className="flex gap-x-3">
            {CARDS.map((card) => (
              <div
                key={card}
                className="flex size-24 shrink-0 items-center justify-center rounded-md bg-surface text-lg font-semibold text-foreground"
              >
                {card}
              </div>
            ))}
          </div>
        </ScrollView>
        <LabCaveat>
          Do not try to verify this from computed styles. The{" "}
          <code>clickable</code> utility deliberately writes the longhand{" "}
          <code>pan-x pan-y pinch-zoom</code> to work around WebKit 240917
          (<code>manipulation</code> suppresses <code>pointercancel</code>
          ), and Chrome canonicalises the longhand back to{" "}
          <code>manipulation</code> when you read it — so a computed{" "}
          <code>touch-action</code> looks identical whether the CSS is
          right or wrong. The gesture is the only honest test.
        </LabCaveat>
      </LabSection>

      <LabSection
        title="fade — edges that dissolve, and get out of the way when parked"
        description="A mask on the scroller itself, not a coloured band over it, so it works over any backdrop and there is no colour to keep in sync. Each end fades only while there is content that way: parked at the top, the top is crisp."
      >
        <ScrollView
          fade
          fadeSize="2.5rem"
          className="h-40 rounded-md bg-surface p-3"
        >
          {ROWS.map((row) => (
            <p key={row} className="py-1 text-sm text-foreground">
              Row {row} — crisp at the very top, fades once you scroll.
            </p>
          ))}
        </ScrollView>
        <LabRow
          label="depth"
          value='fadeSize="2.5rem"'
          hint="A prop, like every other knob. Default is 2rem. There is no edge-fade-* class — one knob with two ways to set it meant the prop silently beat the class."
        />
        <LabRow
          label="a depth that changes with a variant"
          value='className="[--fade-length:1rem] md:[--fade-length:3rem]"'
          hint="The one thing a prop cannot express. Leave fadeSize off and set the variable directly — one line, no second API."
        />
      </LabSection>

      <LabSection
        title="fade='end' — one end only"
        description="start and end are LOGICAL to the scroll axis, so the same two values read correctly vertically and horizontally (and in RTL). Here only the far end fades: the list is anchored at the top and hints that it continues."
      >
        <ScrollView
          fade="end"
          fadeSize="3rem"
          className="h-40 rounded-md bg-surface p-3"
        >
          {ROWS.map((row) => (
            <p key={row} className="py-1 text-sm text-foreground">
              Row {row} — the top never fades, however far you scroll.
            </p>
          ))}
        </ScrollView>
      </LabSection>

      <LabSection
        title="fade on a horizontal scroller"
        description="The same prop, the same two names. Nothing in the component branches on orientation — the mask reads its direction from CSS."
      >
        <ScrollView
          horizontal
          fade
          fadeSize="2rem"
          className="gap-x-2 rounded-md bg-surface p-3"
        >
          {ROWS.map((row) => (
            <span
              key={row}
              className="shrink-0 rounded-full bg-secondary px-4 py-2 text-sm text-foreground"
            >
              chip {row}
            </span>
          ))}
        </ScrollView>
        <LabCaveat>
          A tall fade used to be unusable because it greyed out the content you were
          reading even when parked against that edge. That is what the strengths fix,
          and it is why the depths on this page are deliberately large — at{" "}
          <code>fadeSize="3rem"</code> a permanently-on fade would be obvious.
        </LabCaveat>
      </LabSection>

    </LabPage>
  )
}
