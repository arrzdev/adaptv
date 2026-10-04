import { Pressable, Swipeable, View } from "@arrzdev/adaptv/components"
import { useState } from "react"

const NOTES = ["Groceries", "Call the landlord", "Book flights"]

export function SwipeableDemo() {
  const [rows, setRows] = useState([0, 1, 2])
  const [last, setLast] = useState("nothing yet")
  return (
    <View className="w-full max-w-sm gap-2">
      <Swipeable.Group>
        {rows.map((row) => (
          <Swipeable
            key={row}
            className="rounded-xl"
            onOpen={(side) => setLast(`"${NOTES[row]}" opened ${side}`)}
            onClose={() => setLast(`"${NOTES[row]}" closed`)}
          >
            <Swipeable.Content>
              <View className="bg-raised px-4 py-3.5 text-[14px] text-foreground">
                {NOTES[row]}
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
