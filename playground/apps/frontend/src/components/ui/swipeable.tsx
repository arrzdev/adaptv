import { Swipeable as BaseSwipeable, View } from "adaptv/components"
import type { ComponentProps, ReactElement, ReactNode } from "react"
import { Children, isValidElement } from "react"
import { cn } from "@/utils/cn"

const SWIPEABLE_ROOT_CLASSNAME = cn("rounded-md")

type SwipeableRootProps = ComponentProps<typeof BaseSwipeable>

function AppSwipeableRoot({
  className,
  children,
  ...props
}: SwipeableRootProps) {
  return (
    <BaseSwipeable
      className={cn(SWIPEABLE_ROOT_CLASSNAME, className)}
      {...props}
    >
      {Children.map(children, expandSlot)}
    </BaseSwipeable>
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
      <View row className={cn("flex h-full items-stretch", className)}>
        {children}
      </View>
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
      <View row className={cn("flex h-full items-stretch", className)}>
        {children}
      </View>
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
      {/* no wrapper without a className: Swipeable reads a rounded card's radius from
          the one element the content renders */}
      {className ? <div className={className}>{children}</div> : children}
    </BaseSwipeable.Content>
  )
}
AppSwipeableContent.displayName = "Swipeable.Content"

type SlotWrapper = (props: SwipeableActionsProps) => ReactElement

//Swipeable reads a slot's children without rendering the slot, so a wrapper named after
//one never renders and its className is lost. The root renders each wrapper here, which
//hands Swipeable the slot it builds.
const SLOT_WRAPPERS = new Set<unknown>([
  AppSwipeableLeftActions,
  AppSwipeableRightActions,
  AppSwipeableContent,
])

function expandSlot(child: ReactNode): ReactNode {
  if (!isValidElement<SwipeableActionsProps>(child)) return child
  if (!SLOT_WRAPPERS.has(child.type)) return child
  return (child.type as SlotWrapper)(child.props)
}

export const AppSwipeable = Object.assign(AppSwipeableRoot, {
  Group: BaseSwipeable.Group,
  LeftActions: AppSwipeableLeftActions,
  RightActions: AppSwipeableRightActions,
  Content: AppSwipeableContent,
})
