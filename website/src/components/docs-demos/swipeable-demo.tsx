import { Pressable, Swipeable, View } from "adaptv/components"
import { useState } from "react"
import { cn } from "@/utils/cn"

const NOTES = ["Groceries", "Call the landlord", "Book flights"]

export function SwipeableDemo() {
  const [rows, setRows] = useState([0, 1, 2])
  const [last, setLast] = useState("nothing yet")
  return (
    <View className="w-full max-w-sm gap-2">
      {/* one rounded card clips the rows: a row slides under its edge and the action
          sits flush against it, with no radius or gap of its own */}
      {rows.length > 0 ? (
        <View className="overflow-hidden rounded-xl border border-border-strong bg-raised">
          <Swipeable.Group>
            {rows.map((row, index) => (
              <Swipeable
                key={row}
                onOpen={(side) => setLast(`"${NOTES[row]}" opened ${side}`)}
                onClose={() => setLast(`"${NOTES[row]}" closed`)}
              >
                <Swipeable.Content>
                  <View className="bg-raised pl-4 text-[14px] text-foreground">
                    <View
                      className={cn(
                        "py-3.5 pr-4",
                        index > 0 && "border-border-strong border-t",
                      )}
                    >
                      <span>{NOTES[row]}</span>
                    </View>
                  </View>
                </Swipeable.Content>
                <Swipeable.LeftActions>
                  <Pressable
                    onPress={() => setLast(`"${NOTES[row]}" pinned`)}
                    className="flex h-full w-20 items-center justify-center bg-brand font-medium text-[13px] text-white"
                  >
                    Pin
                  </Pressable>
                </Swipeable.LeftActions>
                <Swipeable.RightActions>
                  <Pressable
                    onPress={() =>
                      setRows((list) => list.filter((item) => item !== row))
                    }
                    className="flex h-full w-20 items-center justify-center bg-danger font-medium text-[13px] text-white"
                  >
                    Delete
                  </Pressable>
                </Swipeable.RightActions>
              </Swipeable>
            ))}
          </Swipeable.Group>
        </View>
      ) : null}
      {rows.length === 0 ? (
        <Pressable
          onPress={() => setRows([0, 1, 2])}
          className="flex self-center rounded-full bg-sunken px-4 py-2 font-medium text-[13px] text-foreground"
        >
          Bring them back
        </Pressable>
      ) : null}
      <span className="pt-1 text-center font-mono text-[13px] text-muted">
        {last}
      </span>
    </View>
  )
}
