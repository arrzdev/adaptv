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
      <View row className="justify-between text-[12px] text-muted">
        <span>{label}</span>
        {note ? <span>{note}</span> : null}
      </View>
      <span className="font-semibold text-[20px] tracking-[-0.02em]">
        {value}
      </span>
      {children}
    </View>
  )
}

/**
 * Tally in a desktop browser window: a sidebar, the month at a glance, a chart, the budgets
 * and the latest transactions. Laid out at 1000 × 580 and scaled down as a whole on a phone,
 * so it keeps its desktop layout at every width.
 */
export function TallyDesktop({ className }: { className?: string }) {
  return (
    <div
      data-testid="tally-desktop"
      className={cn("fit [--fit:1000px]", className)}
    >
      <BrowserFrame url="tally.app" className="h-[580px] text-left">
        <View row className="h-full min-h-0">
          <View
            data-testid="tally-sidebar"
            className="w-[200px] shrink-0 gap-6 border-border border-r bg-sunken px-4 py-5"
          >
            <View row className="items-center gap-2 px-2">
              <span className="grid size-6 place-items-center rounded-md bg-brand font-bold text-[13px] text-brand-foreground">
                T
              </span>
              <span className="font-semibold text-[15px] tracking-[-0.01em]">
                Tally
              </span>
            </View>
            <View className="gap-0.5">
              {NAV.map(({ label, icon: Icon }, index) => (
                <View
                  key={label}
                  row
                  className={cn(
                    "h-8 items-center gap-2.5 rounded-md px-2 text-[13px]",
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
              <span className="font-semibold text-[24px] leading-tight tracking-[-0.03em]">
                {MONTH}
              </span>
              <span className="text-[13px] text-muted">
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

            <div className="grid grid-cols-[1.15fr_1fr] gap-3">
              <View className="gap-2 rounded-xl border border-border bg-surface px-4 py-3">
                <span className="font-medium text-[13px]">Daily spending</span>
                <View
                  row
                  data-testid="tally-chart"
                  className="h-[64px] items-end gap-1.5 border-border border-b"
                >
                  {DAILY.map((amount, index) => {
                    const future = index + 1 > TODAY
                    return (
                      <div
                        // biome-ignore lint/suspicious/noArrayIndexKey: a bar is its day
                        key={index}
                        data-testid="tally-bar"
                        className={cn(
                          "flex-1 rounded-t-[3px]",
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
                <View row className="justify-between text-[11px] text-muted">
                  <span>Oct 1</span>
                  <span>Oct 14</span>
                </View>
              </View>

              <View className="gap-1.5 rounded-xl border border-border bg-surface px-4 py-3">
                <span className="font-medium text-[13px]">Budgets</span>
                {BUDGETS.map((budget) => (
                  <View key={budget.name} className="gap-0.5">
                    <View row className="justify-between text-[12px]">
                      <span>{budget.name}</span>
                      <span className="text-muted">
                        {`${usd(budget.spent)} of ${usd(budget.limit)}`}
                      </span>
                    </View>
                    <Bar value={percent(budget.spent, budget.limit)} />
                  </View>
                ))}
              </View>
            </div>

            <View className="rounded-xl border border-border bg-surface px-4 py-2.5">
              <span className="pb-0.5 font-medium text-[13px]">Recent</span>
              <table className="w-full text-[12px]">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="py-[2px] font-normal">Merchant</th>
                    <th className="py-[2px] font-normal">Category</th>
                    <th className="py-[2px] font-normal">Date</th>
                    <th className="py-[2px] text-right font-normal">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {TRANSACTIONS.map((t) => (
                    <tr key={t.merchant} className="border-border border-t">
                      <td className="py-[2px] font-medium">{t.merchant}</td>
                      <td className="py-[2px] text-subtle">{t.category}</td>
                      <td className="py-[2px] text-subtle">{t.date}</td>
                      <td
                        className={cn(
                          "py-[2px] text-right tabular-nums",
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
