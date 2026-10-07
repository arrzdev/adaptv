import { Loader2 } from "lucide-react"
import { useAppReducedMotion } from "@/hooks/use-app-reduced-motion"
import { cn } from "@/utils/cn"

type ButtonSpinnerProps = {
  className?: string
}

//trailing loading indicator for buttons. inherits the button's (aria-busy) text
//color via currentColor; spin is dropped under reduced motion.
export function ButtonSpinner({ className }: ButtonSpinnerProps) {
  const reducedMotion = useAppReducedMotion()

  return (
    <Loader2
      aria-hidden
      className={cn("size-4", !reducedMotion && "animate-spin", className)}
    />
  )
}
