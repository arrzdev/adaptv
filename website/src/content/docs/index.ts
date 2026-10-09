import { page as appShellComponentsPage } from "./pages/app-shell-components"
import { page as avoidKeyboardPage } from "./pages/avoid-keyboard"
import { page as buttonPage } from "./pages/button"
import { page as capabilitiesPage } from "./pages/capabilities"
import { page as checkboxPage } from "./pages/checkbox"
import { page as cliPage } from "./pages/cli"
import { page as configPage } from "./pages/config"
import { page as deployingPage } from "./pages/deploying"
import { page as drawerPage } from "./pages/drawer"
import { page as dropdownPage } from "./pages/dropdown"
import { page as filesystemPage } from "./pages/filesystem"
import { page as hooksDataPage } from "./pages/hooks-data"
import { page as hooksDevicePage } from "./pages/hooks-device"
import { page as hooksFeedbackPage } from "./pages/hooks-feedback"
import { page as hooksLifecyclePage } from "./pages/hooks-lifecycle"
import { page as hooksUpdatesPage } from "./pages/hooks-updates"
import { page as iconsAndSplashPage } from "./pages/icons-and-splash"
import { page as imagePage } from "./pages/image"
import { page as inputPage } from "./pages/input"
import { page as introductionPage } from "./pages/introduction"
import { page as keyboardPage } from "./pages/keyboard"
import { page as layoutShiftPage } from "./pages/layout-shift"
import { page as linkPage } from "./pages/link"
import { page as listPage } from "./pages/list"
import { page as nativeBuildsPage } from "./pages/native-builds"
import { page as offlinePage } from "./pages/offline"
import { page as offlineBoundaryPage } from "./pages/offline-boundary"
import { page as otaUpdatesPage } from "./pages/ota-updates"
import { page as pressablePage } from "./pages/pressable"
import { page as projectStructurePage } from "./pages/project-structure"
import { page as pullToRefreshPage } from "./pages/pull-to-refresh"
import { page as quickStartPage } from "./pages/quick-start"
import { page as renderingPage } from "./pages/rendering"
import { page as routerApiPage } from "./pages/router-api"
import { page as routingPage } from "./pages/routing"
import { page as safeAreasPage } from "./pages/safe-areas"
import { page as scrollViewPage } from "./pages/scroll-view"
import { page as sixTargetsPage } from "./pages/six-targets"
import { page as storagePage } from "./pages/storage"
import { page as stylingPage } from "./pages/styling"
import { page as swipeablePage } from "./pages/swipeable"
import { page as switchPage } from "./pages/switch"
import { page as textPage } from "./pages/text"
import { page as theFramePage } from "./pages/the-frame"
import { page as themingPage } from "./pages/theming"
import { page as utilsPage } from "./pages/utils"
import { page as viewPage } from "./pages/view"
import { page as vitePluginPage } from "./pages/vite-plugin"
import { page as wheelColumnPage } from "./pages/wheel-column"
import type { DocGroup } from "./types"

export type { DocGroup, DocPage } from "./types"

//Sidebar order. A page exists once it is listed here; the overview and the pager both
//read this list.
export const DOCS: DocGroup[] = [
  {
    section: "Guides",
    title: "Get started",
    pages: [
      introductionPage,
      quickStartPage,
      projectStructurePage,
      sixTargetsPage,
    ],
  },
  {
    section: "Guides",
    title: "Concepts",
    pages: [
      theFramePage,
      routingPage,
      renderingPage,
      stylingPage,
      themingPage,
      layoutShiftPage,
      safeAreasPage,
      keyboardPage,
    ],
  },
  {
    section: "Guides",
    title: "Shipping",
    pages: [
      offlinePage,
      otaUpdatesPage,
      deployingPage,
      nativeBuildsPage,
      iconsAndSplashPage,
    ],
  },
  {
    section: "Reference",
    title: "Components",
    pages: [
      viewPage,
      scrollViewPage,
      textPage,
      buttonPage,
      pressablePage,
      linkPage,
      imagePage,
      inputPage,
      checkboxPage,
      switchPage,
      dropdownPage,
      listPage,
      wheelColumnPage,
      drawerPage,
      swipeablePage,
      pullToRefreshPage,
      avoidKeyboardPage,
      offlineBoundaryPage,
      appShellComponentsPage,
    ],
  },
  {
    section: "Reference",
    title: "Hooks",
    pages: [
      hooksDevicePage,
      hooksLifecyclePage,
      hooksFeedbackPage,
      hooksDataPage,
      hooksUpdatesPage,
    ],
  },
  {
    section: "Reference",
    title: "APIs",
    pages: [
      capabilitiesPage,
      filesystemPage,
      storagePage,
      routerApiPage,
      utilsPage,
    ],
  },
  {
    section: "Reference",
    title: "Config and CLI",
    pages: [configPage, cliPage, vitePluginPage],
  },
]

export const ALL_DOCS = DOCS.flatMap((group) => group.pages)
