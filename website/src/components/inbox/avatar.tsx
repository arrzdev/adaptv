import { cn } from "@arrzdev/adaptv/utils"
import type { Message } from "./inbox-data"

export function Avatar({
  message,
  className,
}: {
  message: Pick<Message, "from" | "hue">
  className?: string
}) {
  const initials = message.from
    .split(" ")
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
  return (
    <span
      className={cn(
        "grid size-9 shrink-0 place-items-center rounded-full font-semibold text-[11px] text-white",
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(135deg, ${message.hue[0]}, ${message.hue[1]})`,
      }}
    >
      {initials}
    </span>
  )
}
