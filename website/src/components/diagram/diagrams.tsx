import { Diagram, Tile } from "@/components/diagram/kit"

/*
 * The diagrams of "The hard parts are already decided" (landing-v4 §2.4) that no recording
 * replaces yet: keyboard, safe areas, build guard. Each draws what the framework owns; the
 * card under it says it in words.
 */

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
