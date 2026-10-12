import { getRequest } from "adaptv/request"

export function viaAdaptvRequest() {
  return getRequest().headers.get("user-agent")
}
