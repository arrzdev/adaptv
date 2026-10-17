import { Diagram, Tile, Wire } from "@/components/diagram/kit"
import { AndroidMark, IosMark } from "@/components/sections/targets"

/*
 * One diagram per decision on "The hard parts are already decided" (landing-v4 §2.4). Each
 * draws what the framework owns; the card under it says it in words.
 */

const TARGETS = [
  { x: 20, caption: "Web" },
  { x: 166, caption: "PWA" },
  { x: 312, caption: "App Store" },
  { x: 458, caption: "Google Play" },
] as const

/** One app (the brand tile) wired down to the four places it ships; the web is the accent. */
export function TargetsDiagram() {
  return (
    <Diagram viewBox="0 0 590 290" maxWidth={640}>
      {TARGETS.map(({ x }, i) => (
        <Wire
          key={x}
          d={`M295 106 C295 160 ${x + 56} 142 ${x + 56} 196`}
          accent={i === 0}
        />
      ))}
      <Tile index={0}>
        <rect
          className="tile brand"
          x="245"
          y="6"
          width="100"
          height="100"
          rx="26"
        />
        <circle
          cx="295"
          cy="56"
          r="19"
          fill="none"
          stroke="var(--brand)"
          strokeWidth="7"
        />
      </Tile>
      {TARGETS.map(({ x, caption }, i) => {
        const cx = x + 56
        return (
          <Tile key={x} index={i + 1}>
            <rect
              className="tile"
              x={x}
              y="196"
              width="112"
              height="88"
              rx="22"
            />
            {i === 0 ? (
              <>
                <rect
                  className="glyph"
                  x={cx - 23}
                  y="212"
                  width="46"
                  height="32"
                  rx="4"
                />
                <path className="glyph" d={`M${cx - 23} 220h46`} />
              </>
            ) : null}
            {i === 1 ? (
              <>
                <rect
                  className="glyph"
                  x={cx - 13}
                  y="208"
                  width="26"
                  height="40"
                  rx="6"
                />
                <path className="glyph" d={`M${cx - 4} 241h8`} />
              </>
            ) : null}
            {i === 2 ? (
              <IosMark
                x={cx - 20}
                y="216"
                width="40"
                height="20"
                className="ink"
              />
            ) : null}
            {i === 3 ? (
              <AndroidMark
                x={cx - 18}
                y="216"
                width="36"
                height="20.5"
                className="ink"
              />
            ) : null}
            <text className="caption" x={cx} y="272" textAnchor="middle">
              {caption}
            </text>
          </Tile>
        )
      })}
    </Diagram>
  )
}

/** Three gestures that want the same touch, wired into one owner. */
export function GesturesDiagram() {
  return (
    <Diagram viewBox="0 0 360 230" maxWidth={360}>
      <rect className="dash" x="20" y="20" width="320" height="190" rx="28" />
      <Wire d="M78 84 C78 130 180 110 180 150" />
      <Wire d="M282 84 C282 130 180 110 180 150" />
      <Wire d="M180 44 V150" accent />
      <Tile index={0}>
        <rect className="tile" x="30" y="40" width="96" height="44" rx="14" />
        <text className="label" x="78" y="67" textAnchor="middle">
          Sheet
        </text>
      </Tile>
      <Tile index={1}>
        <rect
          className="tile brand"
          x="132"
          y="0"
          width="96"
          height="44"
          rx="14"
        />
        <text className="label" x="180" y="27" textAnchor="middle">
          Back swipe
        </text>
      </Tile>
      <Tile index={2}>
        <rect className="tile" x="234" y="40" width="96" height="44" rx="14" />
        <text className="label" x="282" y="67" textAnchor="middle">
          Refresh
        </text>
      </Tile>
      <Tile index={3}>
        <rect
          className="tile"
          x="120"
          y="150"
          width="120"
          height="56"
          rx="18"
        />
        <circle className="brand-fill" cx="146" cy="178" r="5" />
        <text className="label" x="158" y="183">
          One owner
        </text>
      </Tile>
    </Diagram>
  )
}

const KEYS = [
  ...Array.from({ length: 6 }, (_, i) => ({ x: 128 + i * 18, y: 156, w: 14 })),
  ...Array.from({ length: 5 }, (_, i) => ({ x: 134 + i * 18, y: 174, w: 14 })),
  { x: 150, y: 194, w: 60 },
]

/** A phone with the keyboard up: the sheet and its focused field rest on the keyboard's top. */
export function KeyboardDiagram() {
  return (
    <Diagram viewBox="0 0 360 230" maxWidth={360}>
      <rect className="tile" x="110" y="0" width="140" height="230" rx="26" />
      <path className="dash" d="M40 144 H320" />
      <text className="caption" x="40" y="136">
        keyboard top
      </text>
      <Tile index={0}>
        <rect
          className="soft"
          x="122"
          y="150"
          width="116"
          height="68"
          rx="6"
          opacity=".55"
        />
        {KEYS.map((k) => (
          <rect
            key={`${k.x}-${k.y}`}
            x={k.x}
            y={k.y}
            width={k.w}
            height="12"
            rx="2"
            fill="var(--tile)"
          />
        ))}
      </Tile>
      <Tile index={1}>
        <rect
          className="tile brand"
          x="122"
          y="84"
          width="116"
          height="60"
          rx="14"
        />
        <rect className="soft" x="166" y="90" width="28" height="3" rx="1.5" />
        <rect
          x="132"
          y="104"
          width="96"
          height="26"
          rx="8"
          fill="none"
          stroke="var(--brand)"
          strokeWidth="1.5"
        />
        <rect className="brand-fill" x="140" y="111" width="1.6" height="12" />
      </Tile>
    </Diagram>
  )
}

/** A phone edge to edge: content fills the screen between the two safe-area lines. */
export function SafeAreasDiagram() {
  return (
    <Diagram viewBox="0 0 360 230" maxWidth={360}>
      <rect className="tile" x="110" y="0" width="140" height="230" rx="26" />
      <rect className="ink" x="152" y="8" width="56" height="14" rx="7" />
      <rect
        x="110.6"
        y="30"
        width="138.8"
        height="170"
        fill="color-mix(in oklab, var(--brand) 10%, transparent)"
      />
      <path
        className="dash"
        d="M70 30 H290 M70 200 H290"
        style={{ stroke: "var(--brand)", opacity: 0.7 }}
      />
      <text className="caption" x="296" y="34">
        top
      </text>
      <text className="caption" x="296" y="204">
        bottom
      </text>
      <Tile index={0}>
        <rect className="soft" x="124" y="44" width="80" height="10" rx="5" />
      </Tile>
      {[66, 102, 138].map((y, i) => (
        <Tile key={y} index={i + 1}>
          <rect
            className="soft"
            x="124"
            y={y}
            width="112"
            height="28"
            rx="8"
            opacity=".6"
          />
        </Tile>
      ))}
      <rect className="ink" x="150" y="214" width="60" height="4" rx="2" />
    </Diagram>
  )
}

/**
 * `adaptv build ios` stopping on a server function. The message is the build's own
 * (`describeBoundary` in src/vite/server-boundary.ts); the file and line are an example.
 */
export function BuildGuardDiagram() {
  return (
    <Diagram viewBox="0 0 360 230" maxWidth={360}>
      <rect className="tile" x="0" y="16" width="360" height="198" rx="22" />
      <text
        className="mono"
        x="22"
        y="52"
        style={{ fill: "var(--foreground)" }}
      >
        $ adaptv build ios
      </text>
      <path className="wire" d="M0 70 H360" />
      <Tile index={0}>
        <rect
          x="10"
          y="84"
          width="340"
          height="114"
          rx="14"
          fill="color-mix(in oklab, var(--danger) 12%, transparent)"
        />
        <circle cx="30" cy="109" r="6" fill="var(--danger)" />
        <text
          className="mono"
          x="46"
          y="114"
          style={{ fill: "var(--foreground)" }}
        >
          this app has 1 server function,
        </text>
        <text
          className="mono"
          x="46"
          y="136"
          style={{ fill: "var(--foreground)" }}
        >
          and adaptv apps have no server side
        </text>
        <text className="mono" x="46" y="172" style={{ fontSize: 11.5 }}>
          src/routes/pay.ts:4 createServerFn
        </text>
      </Tile>
    </Diagram>
  )
}
