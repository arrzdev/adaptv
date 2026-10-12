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
      <span className="px-4 text-[13px] text-muted uppercase">{title}</span>
      <View className="overflow-hidden rounded-[10px] bg-raised [&>*+*]:border-border [&>*+*]:border-t">
        {children}
      </View>
    </View>
  )
}

/**
 * Tally on an iPhone: the same month as the desktop window, as a large title, a card and
 * two inset grouped lists over a tab bar. Laid out in points on a 393 × 852 screen and
 * scaled to the frame, so it reads as iOS at any size.
 */
export function TallyPhone({ className }: { className?: string }) {
  return (
    <div data-testid="tally-phone" className={className}>
      <PhoneFrame platform="ios">
        <div className="@container aspect-[393/852] min-h-0 w-full bg-sunken text-left text-foreground">
          <div className="fit relative h-[852px] [--fit:393px]">
            <View
              row
              className="h-[54px] items-center justify-between px-[38px] pt-[6px] font-semibold text-[17px]"
            >
              <span>9:41</span>
              <View row className="items-center gap-1.5">
                <Signal className="size-[18px]" strokeWidth={2.5} />
                <Wifi className="size-[18px]" strokeWidth={2.5} />
                <BatteryFull className="size-[24px]" strokeWidth={2} />
              </View>
            </View>

            <View className="px-5 pt-2 pb-4">
              <span
                data-testid="tally-large-title"
                className="font-bold text-[34px] leading-[41px] tracking-[0.01em]"
              >
                {MONTH}
              </span>
              <span className="text-[17px] text-muted">{`${usd(LEFT)} left`}</span>
            </View>

            <View className="gap-6">
              <View className="mx-4 gap-2.5 rounded-[10px] bg-raised p-4">
                <span className="text-[15px]">
                  {`${usd(SPENT)} of ${usd(BUDGET)} spent`}
                </span>
                <Bar value={percent(SPENT, BUDGET)} className="h-2" />
              </View>

              <Group title="Budgets">
                {BUDGETS.slice(0, 3).map((budget) => (
                  <View key={budget.name} className="gap-2 px-4 py-3">
                    <View row className="justify-between text-[17px]">
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
                    className="h-11 items-center justify-between px-4 text-[17px]"
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
              className="absolute inset-x-0 bottom-0 h-[83px] justify-around border-border border-t bg-raised/90 px-2 pt-[7px]"
            >
              {TABS.map(({ label, icon: Icon }, index) => (
                <View
                  key={label}
                  className={cn(
                    "w-20 items-center gap-1 font-medium text-[10px]",
                    index === 0 ? "text-brand" : "text-muted",
                  )}
                >
                  <Icon className="size-6" strokeWidth={2} />
                  {label}
                </View>
              ))}
              <span className="absolute bottom-2 left-1/2 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-foreground" />
            </View>
          </div>
        </div>
      </PhoneFrame>
    </div>
  )
}
