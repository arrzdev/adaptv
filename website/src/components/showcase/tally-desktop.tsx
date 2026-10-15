import { View } from "adaptv/components"
import {
  ArrowLeftRight,
  LayoutDashboard,
  type LucideIcon,
  PiggyBank,
  Settings,
  Wallet,
} from "lucide-react"
import { BrowserFrame } from "@/components/frames"
import {
  BUDGET,
  BUDGETS,
  DAILY,
  INCOME,
  LEFT,
  MONTH,
  percent,
  SPENT,
  signed,
  TODAY,
  TRANSACTIONS,
  usd,
} from "@/components/showcase/tally-data"
import { cn } from "@/utils/cn"

const NAV: { label: string; icon: LucideIcon }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Transactions", icon: ArrowLeftRight },
  { label: "Budgets", icon: PiggyBank },
  { label: "Accounts", icon: Wallet },
  { label: "Settings", icon: Settings },
]

const PEAK = Math.max(...DAILY)

/** A thin progress bar; the fill is the brand colour. */
export function Bar({
  value,
  className,
}: {
  value: number
  className?: string
}) {
  return (
    <div
      className={cn("h-1.5 overflow-hidden rounded-full bg-sunken", className)}
    >
      <div
        className="h-full rounded-full bg-brand"
        style={{ width: `${value}%` }}
      />
    </div>
  )
}

function Card({
  label,
  note,
  value,
  children,
}: {
  label: string
  /** Muted, at the end of the label's row. */
  note?: string
  value: string
  children?: React.ReactNode
}) {
  return (
    <View className="gap-0.5 rounded-xl border border-border bg-surface px-4 py-3">
      {/* the note sits left-aligned after a fixed edge, in a box as wide as it is in Geist:
          right-aligned, it moved when the web font swapped in */}
      <View
        row
        className="justify-between text-[length:calc(12*var(--u))] text-muted"
      >
        <span>{label}</span>
        {note ? (
          <span className="w-[calc(56*var(--u))] shrink-0 whitespace-nowrap">
            {note}
          </span>
        ) : null}
      </View>
      <span className="font-semibold text-[length:calc(20*var(--u))] tracking-[-0.02em]">
        {value}
      </span>
      {children}
    </View>
  )
}

/**
 * Tally in a desktop browser window: a sidebar, the month at a glance, a chart, the budgets
 * and the latest transactions. Drawn on a 1000 × 580 grid in container units (`.mock`), so it
 * keeps its desktop layout at every width without being scaled.
 */
export function TallyDesktop({ className }: { className?: string }) {
  return (
    <div
      data-testid="tally-desktop"
      className={cn("mock [--mock-w:1000]", className)}
    >
      <BrowserFrame
        url="tally.app"
        className="h-[calc(580*var(--u))] text-left"
      >
        <View row className="h-full min-h-0">
          <View
            data-testid="tally-sidebar"
            className="w-[calc(200*var(--u))] shrink-0 gap-6 border-border border-r bg-sunken px-4 py-5"
          >
            <View row className="items-center gap-2 px-2">
              <span className="grid size-6 place-items-center rounded-md bg-brand font-bold text-[length:calc(13*var(--u))] text-brand-foreground">
                T
              </span>
              <span className="font-semibold text-[length:calc(15*var(--u))] tracking-[-0.01em]">
                Tally
              </span>
            </View>
            <View className="gap-0.5">
              {NAV.map(({ label, icon: Icon }, index) => (
                <View
                  key={label}
                  row
                  className={cn(
                    "h-8 items-center gap-2.5 rounded-md px-2 text-[length:calc(13*var(--u))]",
                    index === 0
                      ? "bg-surface font-medium text-foreground"
                      : "text-subtle",
                  )}
                >
                  <Icon className="size-4" strokeWidth={2} />
                  {label}
                </View>
              ))}
            </View>
          </View>

          <View className="min-w-0 flex-1 gap-3 overflow-hidden px-7 py-4">
            <View className="gap-0.5">
              <span className="font-semibold text-[length:calc(24*var(--u))] leading-tight tracking-[-0.03em]">
                {MONTH}
              </span>
              <span className="text-[length:calc(13*var(--u))] text-muted">
                {`${usd(LEFT)} left to spend`}
              </span>
            </View>

            <div className="grid grid-cols-3 gap-3">
              <Card label="Spent" note={`of ${usd(BUDGET)}`} value={usd(SPENT)}>
                <Bar value={percent(SPENT, BUDGET)} className="mt-1" />
              </Card>
              <Card label="Income" value={usd(INCOME)} />
              <Card label="Left" value={usd(LEFT)} />
            </div>

            <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-3">
              <View className="gap-2 rounded-xl border border-border bg-surface px-4 py-3">
                <span className="font-medium text-[length:calc(13*var(--u))]">
                  Daily spending
                </span>
                <View
                  row
                  data-testid="tally-chart"
                  className="h-[calc(64*var(--u))] items-end gap-1.5 border-border border-b"
                >
                  {DAILY.map((amount, index) => {
                    const future = index + 1 > TODAY
                    return (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: a bar is its day
                        key={index}
                        data-testid="tally-bar"
                        className={cn(
                          "flex-1 rounded-t-[calc(3*var(--u))]",
                          future
                            ? "h-1/4 border border-border-strong border-b-0"
                            : "bg-brand",
                        )}
                        style={
                          future
                            ? undefined
                            : { height: `${(amount / PEAK) * 100}%` }
                        }
                      />
                    )
                  })}
                </View>
                <View
                  row
                  className="text-[length:calc(11*var(--u))] text-muted"
                >
                  <span className="flex-1">Oct 1</span>
                  <span className="flex-1 text-right">Oct 14</span>
                </View>
              </View>

              <View className="gap-1.5 rounded-xl border border-border bg-surface px-4 py-3">
                <span className="font-medium text-[length:calc(13*var(--u))]">
                  Budgets
                </span>
                {BUDGETS.map((budget) => (
                  <View key={budget.name} className="gap-0.5">
                    <View row className="text-[length:calc(12*var(--u))]">
                      <span className="flex-1">{budget.name}</span>
                      <span className="flex-1 text-right text-muted">
                        {`${usd(budget.spent)} of ${usd(budget.limit)}`}
                      </span>
                    </View>
                    <Bar value={percent(budget.spent, budget.limit)} />
                  </View>
                ))}
              </View>
            </div>

            <View className="rounded-xl border border-border bg-surface px-4 py-2.5">
              <span className="pb-0.5 font-medium text-[length:calc(13*var(--u))]">
                Recent
              </span>
              {/* fixed columns, as wide as Geist lays them out: auto widths follow the
                  font, and the swap moved every cell */}
              <table className="w-full table-fixed text-[length:calc(12*var(--u))]">
                <colgroup>
                  <col className="w-[calc(207.56*var(--u))]" />
                  <col className="w-[calc(221.78*var(--u))]" />
                  <col className="w-[calc(105.2*var(--u))]" />
                  <col className="w-[calc(173.45*var(--u))]" />
                </colgroup>
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-[calc(2*var(--u))] font-normal">
                      Merchant
                    </th>
                    <th className="py-[calc(2*var(--u))] font-normal">
                      Category
                    </th>
                    <th className="py-[calc(2*var(--u))] font-normal">Date</th>
                    <th className="py-[calc(2*var(--u))] text-right font-normal">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TRANSACTIONS.map((t) => (
                    <tr key={t.merchant} className="border-border border-t">
                      <td className="py-[calc(2*var(--u))] font-medium">
                        {t.merchant}
                      </td>
                      <td className="py-[calc(2*var(--u))] text-subtle">
                        {t.category}
                      </td>
                      <td className="py-[calc(2*var(--u))] text-subtle">
                        {t.date}
                      </td>
                      <td
                        className={cn(
                          "py-[calc(2*var(--u))] text-right tabular-nums",
                          t.amount > 0 && "text-success",
                        )}
                      >
                        {signed(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </View>
          </View>
        </View>
      </BrowserFrame>
    </div>
  )
}
