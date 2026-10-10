import { getRequest } from "@tanstack/react-start/server"

export function viaRequestApi() {
  return getRequest().headers.get("user-agent")
}
