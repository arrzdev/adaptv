import { index, layout, rootRoute, route } from "@arrzdev/adaptv/routes"

//nativ owns the root route (stamped __root.gen.tsx) — declare only the children.
//routing files follow the repo's {domain}.{role} convention: `*.page.tsx` for
//pages, `*.layout.tsx` for nested layouts (see core/repository-layout).
export const routes = rootRoute([
  //app-wide providers (query client, auth, local store) wrap every page
  layout("providers", "layouts/providers.layout.tsx", [
    index("pages/todos.page.tsx"),
    route("/settings", "pages/settings.page.tsx"),
    //a service-worker e2e fixture, alongside `public/sw-probe.pdf` — a route that
    //answers with a redirect instead of a document. See the page for why.
    route("/sw-probe-redirect", "pages/sw-probe-redirect.page.tsx"),
    //the manual-testing surface: an index plus one page per component,
    //framework behaviour and capability/hook. declared flat rather than nested
    //because `/lab` is a real page, not a layout — nesting would force an
    //<Outlet /> into the index.
    route("/lab", "pages/lab.page.tsx"),
    //components
    route("/lab/view-scroll", "pages/lab/view-scroll.page.tsx"),
    route("/lab/list", "pages/lab/list.page.tsx"),
    route("/lab/text", "pages/lab/text.page.tsx"),
    route("/lab/image", "pages/lab/image.page.tsx"),
    route("/lab/button", "pages/lab/button.page.tsx"),
    route("/lab/link", "pages/lab/link.page.tsx"),
    route("/lab/toggles", "pages/lab/toggles.page.tsx"),
    route("/lab/fields", "pages/lab/fields.page.tsx"),
    route("/lab/drawer", "pages/lab/drawer.page.tsx"),
    route("/lab/dropdown", "pages/lab/dropdown.page.tsx"),
    //the drawer's keyboard conformance harness — drives adaptv's keyboard test
    //seam and asserts the sheet's geometry, so one screenshot is the report on
    //every target (a real software keyboard cannot be scripted)
    route("/lab/drawer-keyboard", "pages/lab/drawer-keyboard.page.tsx"),
    route("/lab/swipeable", "pages/lab/swipeable.page.tsx"),
    route("/lab/pull-to-refresh", "pages/lab/pull-to-refresh.page.tsx"),
    route("/lab/wheel-column", "pages/lab/wheel-column.page.tsx"),
    route("/lab/avoid-keyboard", "pages/lab/avoid-keyboard.page.tsx"),
    route("/lab/offline", "pages/lab/offline.page.tsx"),
    route("/lab/edge-swipe", "pages/lab/edge-swipe.page.tsx"),
    route("/lab/screens", "pages/lab/screens.page.tsx"),
    //framework behaviour with no component of its own
    route("/lab/cascade-layers", "pages/lab/cascade-layers.page.tsx"),
    route("/lab/press-states", "pages/lab/press-states.page.tsx"),
    route("/lab/hover-focus", "pages/lab/hover-focus.page.tsx"),
    route("/lab/safe-area", "pages/lab/safe-area.page.tsx"),
    route("/lab/service-worker", "pages/lab/service-worker.page.tsx"),
    //capabilities and hooks
    route("/lab/share", "pages/lab/share.page.tsx"),
    route("/lab/clipboard", "pages/lab/clipboard.page.tsx"),
    route("/lab/device", "pages/lab/device.page.tsx"),
    route("/lab/orientation", "pages/lab/orientation.page.tsx"),
    route("/lab/keep-awake", "pages/lab/keep-awake.page.tsx"),
    route("/lab/notifications", "pages/lab/notifications.page.tsx"),
    route("/lab/app-state", "pages/lab/app-state.page.tsx"),
    route("/lab/back-chain", "pages/lab/back-chain.page.tsx"),
    route("/lab/browser", "pages/lab/browser.page.tsx"),
    route("/lab/geolocation", "pages/lab/geolocation.page.tsx"),
    route(
      "/lab/gesture-controller",
      "pages/lab/gesture-controller.page.tsx",
    ),
    route("/lab/haptic-tick", "pages/lab/haptic-tick.page.tsx"),
    route("/lab/haptics", "pages/lab/haptics.page.tsx"),
    route("/lab/keyboard", "pages/lab/keyboard.page.tsx"),
    route("/lab/chrome-tint", "pages/lab/chrome-tint.page.tsx"),
    route("/lab/route-tint", "pages/lab/route-tint.page.tsx"),
    route("/lab/native-theme", "pages/lab/native-theme.page.tsx"),
    route("/lab/network", "pages/lab/network.page.tsx"),
    route("/lab/ota", "pages/lab/ota.page.tsx"),
    route("/lab/splash", "pages/lab/splash.page.tsx"),
    route("/lab/status-bar", "pages/lab/status-bar.page.tsx"),
    route("/lab/hooks", "pages/lab/hooks.page.tsx"),
    route("/lab/app-feel", "pages/lab/app-feel.page.tsx"),
    route("/lab/pressable", "pages/lab/pressable.page.tsx"),
  ]),
])

export default routes
