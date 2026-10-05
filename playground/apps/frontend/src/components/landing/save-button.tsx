import { Button } from "@arrzdev/adaptv/components"
export const SaveButton = ({ save }: { save: () => void }) => (
  <Button haptic="medium" onClick={save}>
    Save
  </Button>
)
