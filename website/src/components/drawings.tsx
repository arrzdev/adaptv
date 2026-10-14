import type { ReactNode } from "react"

/*
 * Line drawings for the landing's illustrations, in SVG user units and theme colours only,
 * so they follow light and dark. Every part takes its top-left corner and size; nothing in
 * here is text, so a drawing reads the same in any font and never shifts when one swaps.
 */

type Box = { x: number; y: number; w: number; h: number }

/** A row of grey text lines, as wide as the fractions given. */
export function Lines({
  x,
  y,
  w,
  widths,
  gap = 10,
  size = 5,
}: {
  x: number
  y: number
  w: number
  widths: number[]
  gap?: number
  size?: number
}) {
  return (
    <g className="fill-border-strong">
      {widths.map((f, i) => (
        <rect
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed drawing, never reordered
          key={i}
          x={x}
          y={y + i * gap}
          width={w * f}
          height={size}
          rx={size / 2}
        />
      ))}
    </g>
  )
}

/** The React mark: three orbits around a dot. */
export function ReactMark({
  cx,
  cy,
  r,
}: {
  cx: number
  cy: number
  r: number
}) {
  return (
    <g className="stroke-brand" fill="none" strokeWidth={r / 7}>
      {[0, 60, 120].map((angle) => (
        <ellipse
          key={angle}
          cx={cx}
          cy={cy}
          rx={r}
          ry={r * 0.38}
          transform={`rotate(${angle} ${cx} ${cy})`}
        />
      ))}
      <circle
        cx={cx}
        cy={cy}
        r={r * 0.18}
        className="fill-brand"
        stroke="none"
      />
    </g>
  )
}

/** One source file: a card with the React mark and a few lines of code, not readable. */
export function FileCard({ x, y, w, h }: Box) {
  const pad = w * 0.14
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={w * 0.1}
        className="fill-raised stroke-border-strong"
        strokeWidth={1.5}
      />
      <ReactMark cx={x + pad + w * 0.1} cy={y + pad + w * 0.08} r={w * 0.11} />
      <Lines
        x={x + pad}
        y={y + h * 0.48}
        w={w - pad * 2}
        widths={[0.9, 0.62, 0.78, 0.48]}
        gap={h * 0.11}
        size={h * 0.045}
      />
    </g>
  )
}

/** A desktop browser window: title bar, then a wide layout with a sidebar and a grid. */
export function DesktopBrowser({ x, y, w, h }: Box) {
  const bar = h * 0.12
  const pad = w * 0.04
  const side = w * 0.24
  const top = y + bar + pad
  const inner = x + side + pad
  const cell = (x + w - pad - inner - pad) / 2
  const row = (y + h - pad - top - h * 0.12 - pad) / 2
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={10}
        className="fill-surface stroke-border-strong"
        strokeWidth={1.5}
      />
      <line
        x1={x}
        x2={x + w}
        y1={y + bar}
        y2={y + bar}
        className="stroke-border-strong"
        strokeWidth={1.5}
      />
      {[0, 1, 2].map((i) => (
        <circle
          key={i}
          cx={x + 12 + i * 10}
          cy={y + bar / 2}
          r={3}
          className="fill-border-strong"
        />
      ))}
      <rect
        x={x + w * 0.3}
        y={y + bar * 0.28}
        width={w * 0.4}
        height={bar * 0.44}
        rx={bar * 0.22}
        className="fill-raised"
      />
      {/* the wide layout: a sidebar beside the content */}
      <rect
        x={x + pad}
        y={top}
        width={side - pad}
        height={y + h - pad - top}
        rx={6}
        className="fill-brand-soft"
      />
      <Lines
        x={x + pad * 1.8}
        y={top + pad}
        w={side - pad * 2.6}
        widths={[1, 0.7, 0.85, 0.6]}
        gap={h * 0.09}
        size={h * 0.03}
      />
      <rect
        x={inner}
        y={top}
        width={w * 0.3}
        height={h * 0.05}
        rx={h * 0.025}
        className="fill-border-strong"
      />
      {[0, 1].map((r) =>
        [0, 1].map((c) => (
          <rect
            key={`${r}${c}`}
            x={inner + c * (cell + pad)}
            y={top + h * 0.12 + r * (row + pad)}
            width={cell}
            height={row}
            rx={6}
            className="fill-raised stroke-border"
            strokeWidth={1}
          />
        )),
      )}
    </g>
  )
}

/** A phone's body and screen; `children` draws on the screen. */
export function Phone({
  x,
  y,
  w,
  h,
  children,
}: Box & { children?: ReactNode }) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={w * 0.2}
        className="fill-surface stroke-border-strong"
        strokeWidth={1.5}
      />
      {children}
    </g>
  )
}

/** A phone screen's list: a few rows of lines, from `top`. */
function ScreenRows({
  x,
  w,
  top,
  rows,
}: {
  x: number
  w: number
  top: number
  rows: number
}) {
  const pad = w * 0.14
  return (
    <Lines
      x={x + pad}
      y={top}
      w={w - pad * 2}
      widths={Array.from({ length: rows }, (_, i) => [0.9, 0.6, 0.75][i % 3])}
      gap={w * 0.14}
      size={w * 0.05}
    />
  )
}

/** A phone browser: an address bar, the page, and the "Add to Home Screen" badge. */
export function PhoneBrowser({ x, y, w, h }: Box) {
  const pad = w * 0.12
  return (
    <Phone x={x} y={y} w={w} h={h}>
      <rect
        x={x + pad}
        y={y + h * 0.07}
        width={w - pad * 2}
        height={h * 0.06}
        rx={h * 0.03}
        className="fill-raised stroke-border"
        strokeWidth={1}
      />
      <ScreenRows x={x} w={w} top={y + h * 0.2} rows={5} />
      {/* the badge: a plus in a rounded square, then its label */}
      <rect
        x={x + pad * 0.6}
        y={y + h * 0.72}
        width={w - pad * 1.2}
        height={h * 0.13}
        rx={h * 0.035}
        className="fill-brand-soft stroke-brand"
        strokeWidth={1.2}
      />
      <rect
        x={x + pad * 1.1}
        y={y + h * 0.745}
        width={h * 0.08}
        height={h * 0.08}
        rx={h * 0.02}
        fill="none"
        className="stroke-brand"
        strokeWidth={1.2}
      />
      <path
        d={`M${x + pad * 1.1 + h * 0.04} ${y + h * 0.76}v${h * 0.05}M${x + pad * 1.1 + h * 0.015} ${y + h * 0.785}h${h * 0.05}`}
        className="stroke-brand"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <rect
        x={x + pad * 1.1 + h * 0.11}
        y={y + h * 0.775}
        width={w * 0.34}
        height={h * 0.02}
        rx={h * 0.01}
        className="fill-brand"
      />
    </Phone>
  )
}

/** An iPhone: the Dynamic Island, a list, and a bottom sheet over it with its grabber. */
export function IPhone({ x, y, w, h }: Box) {
  const sheet = y + h * 0.52
  const r = w * 0.2
  return (
    <Phone x={x} y={y} w={w} h={h}>
      <rect
        x={x + w * 0.34}
        y={y + h * 0.04}
        width={w * 0.32}
        height={h * 0.045}
        rx={h * 0.0225}
        className="fill-foreground"
      />
      <ScreenRows x={x} w={w} top={y + h * 0.16} rows={4} />
      <path
        d={`M${x + 1} ${sheet + 12}q0 -12 12 -12h${w - 26}q12 0 12 12V${y + h - r}a${r} ${r} 0 0 1 -${r} ${r}H${x + r}a${r} ${r} 0 0 1 -${r - 1} -${r}Z`}
        className="fill-brand-soft stroke-brand"
        strokeWidth={1.2}
      />
      <rect
        x={x + w * 0.4}
        y={sheet + 6}
        width={w * 0.2}
        height={3}
        rx={1.5}
        className="fill-brand"
      />
      <Lines
        x={x + w * 0.14}
        y={sheet + h * 0.09}
        w={w * 0.72}
        widths={[0.8, 0.55]}
        gap={w * 0.14}
        size={w * 0.05}
      />
    </Phone>
  )
}

/** An Android phone: the camera hole, a top app bar with its back arrow, a list. */
export function AndroidPhone({ x, y, w, h }: Box) {
  const pad = w * 0.14
  const bar = y + h * 0.13
  return (
    <Phone x={x} y={y} w={w} h={h}>
      <circle
        cx={x + w / 2}
        cy={y + h * 0.055}
        r={w * 0.035}
        className="fill-foreground"
      />
      <path
        d={`M${x + pad + w * 0.12} ${bar - w * 0.08}l-${w * 0.08} ${w * 0.08}l${w * 0.08} ${w * 0.08}M${x + pad + w * 0.04} ${bar}h${w * 0.2}`}
        fill="none"
        className="stroke-brand"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x={x + pad + w * 0.34}
        y={bar - w * 0.03}
        width={w * 0.3}
        height={w * 0.06}
        rx={w * 0.03}
        className="fill-border-strong"
      />
      <ScreenRows x={x} w={w} top={y + h * 0.24} rows={7} />
      <rect
        x={x + w * 0.35}
        y={y + h - h * 0.05}
        width={w * 0.3}
        height={3}
        rx={1.5}
        className="fill-border-strong"
      />
    </Phone>
  )
}

/** A soft connecting line. */
export function Wire({ d }: { d: string }) {
  return (
    <path
      d={d}
      fill="none"
      className="stroke-border-strong"
      strokeWidth={1.5}
      strokeLinecap="round"
    />
  )
}
