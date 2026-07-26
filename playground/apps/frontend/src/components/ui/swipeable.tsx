import { Swipeable as BaseSwipeable } from "@arrzdev/adaptv/components"
import { cn } from "@arrzdev/adaptv/utils"
import type { ComponentProps, ReactNode } from "react"

const SWIPEABLE_ROOT_CLASSNAME = cn("rounded-md")

type SwipeableRootProps = ComponentProps<typeof BaseSwipeable>

function AppSwipeableRoot({ className, ...props }: SwipeableRootProps) {
  return (
    <BaseSwipeable
      className={cn(SWIPEABLE_ROOT_CLASSNAME, className)}
      {...props}
    />
  )
}
AppSwipeableRoot.displayName = "Swipeable"

type SwipeableActionsProps = {
  children?: ReactNode
  className?: string
}

function AppSwipeableLeftActions({
  children,
  className,
}: SwipeableActionsProps) {
  return (
    <BaseSwipeable.LeftActions>
      <div className={cn("flex h-full items-stretch", className)}>
        {children}
      </div>
    </BaseSwipeable.LeftActions>
  )
}
AppSwipeableLeftActions.displayName = "Swipeable.LeftActions"

function AppSwipeableRightActions({
  children,
  className,
}: SwipeableActionsProps) {
  return (
    <BaseSwipeable.RightActions>
      <div className={cn("flex h-full items-stretch", className)}>
        {children}
      </div>
    </BaseSwipeable.RightActions>
  )
}
AppSwipeableRightActions.displayName = "Swipeable.RightActions"

function AppSwipeableContent({
  children,
  className,
}: {
  children?: ReactNode
  className?: string
}) {
  return (
    <BaseSwipeable.Content>
      <div className={className}>{children}</div>
    </BaseSwipeable.Content>
  )
}
AppSwipeableContent.displayName = "Swipeable.Content"

export const AppSwipeable = Object.assign(AppSwipeableRoot, {
  Group: BaseSwipeable.Group,
  LeftActions: AppSwipeableLeftActions,
  RightActions: AppSwipeableRightActions,
  Content: AppSwipeableContent,
})
