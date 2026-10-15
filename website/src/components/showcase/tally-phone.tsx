import { View } from "adaptv/components"
import {
  ArrowLeftRight,
  BatteryFull,
  LayoutDashboard,
  type LucideIcon,
  PiggyBank,
  Settings,
  Signal,
  Wifi,
} from "lucide-react"
import type { ReactNode } from "react"
import { PhoneFrame } from "@/components/frames"
import {
  BUDGET,
  BUDGETS,
  LEFT,
  MONTH,
  percent,
  SPENT,
  signed,
  TRANSACTIONS,
  usd,
} from "@/components/showcase/tally-data"
import { Bar } from "@/components/showcase/tally-desktop"
import { cn } from "@/utils/cn"

const TABS: { label: string; icon: LucideIcon }[] = [
  { label: "Overview", icon: LayoutDashboard },
  { label: "Transactions", icon: ArrowLeftRight },
  { label: "Budgets", icon: PiggyBank },
  { label: "Settings", icon: Settings },
]

/** An inset grouped list, as iOS Settings draws one. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="gap-1.5 px-4">
      <span className="px-4 text-[length:calc(13*var(--u))] text-muted uppercase">
        {title}
      </span>
      <View className="overflow-hidden rounded-[calc(10*var(--u))] bg-raised [&>*+*]:border-border [&>*+*]:border-t">
        {children}
      </View>
    </View>
  )
}

/**
 * Tally on an iPhone: the same month as the desktop window, as a large title, a card and
 * two inset grouped lists over a tab bar. Drawn in points of a 393 × 852 screen, in container
 * units (`.mock`), so it reads as iOS at any size.
 */
export function TallyPhone({ className }: { className?: string }) {
  return (
    <div data-testid="tally-phone" className={className}>
      <PhoneFrame platform="ios">
        <div className="@container aspect-[393/852] min-h-0 w-full bg-sunken text-left text-foreground">
          <div className="mock relative h-full [--mock-w:393]">
            <View
              row
              className="h-[calc(54*var(--u))] items-center justify-between px-[calc(38*var(--u))] pt-[calc(6*var(--u))] font-semibold text-[length:calc(17*var(--u))]"
            >
              <span>9:41</span>
              {/* as wide as its three icons from the start: the HTML can paint before the
                  last ones are parsed, and a right-aligned group that grew moved left */}
              <View row className="w-[calc(72*var(--u))] items-center gap-1.5">
                <Signal
                  className="size-[calc(18*var(--u))]"
                  strokeWidth={2.5}
                />
                <Wifi className="size-[calc(18*var(--u))]" strokeWidth={2.5} />
                <BatteryFull
                  className="size-[calc(24*var(--u))]"
                  strokeWidth={2}
                />
              </View>
            </View>

            <View className="px-5 pt-2 pb-4">
              <span
                data-testid="tally-large-title"
                className="font-bold text-[length:calc(34*var(--u))] leading-[calc(41*var(--u))] tracking-[0.01em]"
              >
                {MONTH}
              </span>
              <span className="text-[length:calc(17*var(--u))] text-muted">{`${usd(LEFT)} left`}</span>
            </View>

            <View className="gap-6">
              <View className="mx-4 gap-2.5 rounded-[calc(10*var(--u))] bg-raised p-4">
                <span className="text-[length:calc(15*var(--u))]">
                  {`${usd(SPENT)} of ${usd(BUDGET)} spent`}
                </span>
                <Bar value={percent(SPENT, BUDGET)} className="h-2" />
              </View>

              <Group title="Budgets">
                {BUDGETS.slice(0, 3).map((budget) => (
                  <View key={budget.name} className="gap-2 px-4 py-3">
                    <View
                      row
                      className="justify-between text-[length:calc(17*var(--u))]"
                    >
                      <span>{budget.name}</span>
                      <span className="text-muted">{usd(budget.spent)}</span>
                    </View>
                    <Bar value={percent(budget.spent, budget.limit)} />
                  </View>
                ))}
              </Group>

              <Group title="Recent">
                {TRANSACTIONS.slice(0, 3).map((t) => (
                  <View
                    key={t.merchant}
                    row
                    className="h-11 items-center justify-between px-4 text-[length:calc(17*var(--u))]"
                  >
                    <span>{t.merchant}</span>
                    <span
                      className={cn(
                        "tabular-nums",
                        t.amount > 0 ? "text-success" : "text-muted",
                      )}
                    >
                      {signed(t.amount)}
                    </span>
                  </View>
                ))}
              </Group>
            </View>

            <View
              row
              data-testid="tally-tabbar"
              className="absolute inset-x-0 bottom-0 h-[calc(83*var(--u))] justify-around border-border border-t bg-raised/90 px-2 pt-[calc(7*var(--u))]"
            >
              {TABS.map(({ label, icon: Icon }, index) => (
                <View
                  key={label}
                  className={cn(
                    "w-20 items-center gap-1 font-medium text-[length:calc(10*var(--u))]",
                    index === 0 ? "text-brand" : "text-muted",
                  )}
                >
                  <Icon className="size-6" strokeWidth={2} />
                  {label}
                </View>
              ))}
              <span className="absolute bottom-2 left-1/2 h-[calc(5*var(--u))] w-[calc(134*var(--u))] -translate-x-1/2 rounded-full bg-foreground" />
            </View>
          </div>
        </div>
      </PhoneFrame>
    </div>
  )
}
