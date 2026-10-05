import { share } from "@arrzdev/adaptv/capabilities"
import { Button } from "@arrzdev/adaptv/components"
export const ShareButton = ({ url }: { url: string }) => (
  <Button onClick={() => share({ title: "adaptv", url })}>Share</Button>
)
