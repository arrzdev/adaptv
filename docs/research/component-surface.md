# adaptv — component surface research: what Ionic and Expo actually ship

> An inventory of the **component catalogue and public interfaces** of the two ecosystems adaptv
> competes with. The premise: neither team builds a component nobody uses, so the *intersection* of
> what both ship is the strongest available signal for what adaptv should build next.
>
> This doc is **inventory + API shapes**. §7 turns it into a ranked gap list; §9 records the interface
> conventions worth stealing. It is deliberately separate from `docs/decisions/prior-art.md`, which is about Ionic's
> *internals* (gesture math, transition constants) rather than its *surface*.

**Sources — all read from published packages, not docs pages, at these exact versions:**

| Surface | Package | Version | How read |
|---|---|---|---|
| Ionic | `@ionic/core` | **8.8.15** | `dist/docs.json` — the Stencil-generated API doc, 95 components |
| React Native core | `react-native` | **0.86.2** | `types/` + `Libraries/**/*.d.ts` |
| Expo declarative native UI | `@expo/ui` | **57.0.7** | `build/**/types.d.ts` |
| Expo SDK view components | `expo-image` etc. | **57.x** | per-package `build/**/*.d.ts` |
| Expo routing | `expo-router` | **57.0.8** | `build/**/*.d.ts` |
| Expo SDK module roster | `expo` | **57.0.8** | `bundledNativeModules.json` (123 entries) |

---

## 1. The four surfaces at a glance

The two ecosystems are not symmetric. Ionic ships **one** catalogue; Expo ships **four layers** that
overlap:

| Layer | What it is | Count |
|---|---|---|
| **Ionic** `@ionic/core` | One web-component catalogue, dual-rendered `ios` / `md` | **95 components** |
| **RN core** | Unstyled cross-platform primitives — the substrate everything else builds on | ~25 components + ~30 APIs |
| **`@expo/ui` universal** | New declarative wrapper over SwiftUI / Jetpack Compose / web, one API for all three | **18 components** |
| **`@expo/ui` platform** | Direct 1:1 bindings — `swift-ui` (50) and `jetpack-compose` (49), *not* cross-platform | **99 components** |
| **Expo SDK views** | Capability-backed views (image, video, camera, maps, blur, symbols…) | ~12 view packages of 123 modules |
| **`expo-router`** | Navigation primitives — `Link`, `Stack`, `Tabs`, `NativeTabs`, `Modal` | ~15 components + ~15 hooks |

The crucial asymmetry: **Ionic's catalogue is the app UI**; Expo's is a substrate you're expected to
build on (or reach for a third-party kit). `@expo/ui` is Expo's recent move *toward* Ionic's
position — and its 18-component universal set is therefore the single most concentrated signal in
this whole document, because Expo had to pick the smallest set worth unifying across three platforms.

---

## 2. Ionic — the 95-component catalogue

Grouped by role. `p/e/m/s` = props / events / methods / slots.

### 2.1 App frame & navigation (14)

| Component | p/e/m/s | Interface highlights |
|---|---|---|
| `ion-app` | 0/0/1/0 | `setFocus(elements)` |
| `ion-content` | 7/3/5/2 | `fullscreen`, `scrollX`, `scrollY`, `scrollEvents`, `forceOverscroll`, `fixedSlotPlacement`; `ionScroll/Start/End`; `scrollToTop/Bottom/Point/ByPoint`, `getScrollElement` |
| `ion-header` | 3/0/0/0 | `collapse: "condense" \| "fade"`, `translucent` |
| `ion-footer` | 3/0/0/0 | `collapse: "fade"`, `translucent` |
| `ion-toolbar` | 2/0/0/5 | slots `start`, `secondary`, `primary`, `end`, default |
| `ion-title` | 2/0/0/0 | `size: "large" \| "small"` (the iOS large-title mechanism) |
| `ion-buttons` | 1/0/0/0 | `collapse` — participates in large-title collapse |
| `ion-back-button` | 8/0/0/0 | `defaultHref`, `icon`, `text`, `routerAnimation` |
| `ion-tabs` | 0/2/3/3 | `select(tab)`, `getSelected()`; `ionTabsWillChange/DidChange`; slots `top`/`bottom` |
| `ion-tab-bar` | 4/0/0/0 | `selectedTab`, `translucent`, `color` |
| `ion-tab-button` | 9/0/0/0 | `tab`, `href`, `selected`, `layout: icon-top\|icon-start\|…\|label-hide` |
| `ion-menu` | 7/4/6/0 | `side`, `type: overlay\|push\|reveal`, `contentId`, `swipeGesture`, `maxEdgeStart=50`; `open/close/toggle/setOpen/isOpen/isActive` |
| `ion-menu-button` / `ion-menu-toggle` | 6+2 | `autoHide`, `menu` |
| `ion-split-pane` | 3/1/0/0 | `when: boolean \| string = "(min-width: 992px)"` |

Routing (`ion-router`, `ion-route`, `ion-route-redirect`, `ion-router-outlet`, `ion-router-link`,
`ion-nav`, `ion-nav-link`) is a separate 7-component set — largely irrelevant to adaptv, which has
its own file-based router. The one durable idea: **`routerDirection: "forward" | "back" | "root"`**
is threaded through *every* navigable component (`ion-button`, `ion-item`, `ion-card`,
`ion-breadcrumb`, `ion-fab-button`, `ion-router-link`) rather than inferred.

### 2.2 Overlays (8) — one shared contract

`ion-alert` · `ion-action-sheet` · `ion-modal` · `ion-popover` · `ion-toast` · `ion-loading` ·
`ion-picker-legacy` · (`ion-select`'s four interfaces)

Every one of them exposes an identical base interface — this uniformity is the single most
copy-worthy thing in Ionic's API design:

```
props:   isOpen, trigger, animated, backdropDismiss, keyboardClose, cssClass,
         htmlAttributes, enterAnimation, leaveAnimation, mode, translucent
events:  willPresent, didPresent, willDismiss, didDismiss           (+ ion<Name>-prefixed aliases)
methods: present(), dismiss(data?, role?), onWillDismiss<T>(), onDidDismiss<T>()
```

Two presentation modes ship side by side: **declarative** (`isOpen` + JSX) and **imperative**
(`present()`/`dismiss()` returning promises), plus a third — **`trigger`**, an element id that wires
the open-on-click without any state at all.

Per-overlay additions worth noting:

| Overlay | Distinct props |
|---|---|
| `ion-alert` (16p) | `header`, `subHeader`, `message`, `buttons: (string \| AlertButton)[]`, `inputs: AlertInput[]` |
| `ion-action-sheet` (14p) | `header`, `subHeader`, `buttons` |
| `ion-modal` (20p/12e/6m) | `breakpoints: number[]`, `initialBreakpoint`, `backdropBreakpoint`, `handle`, `handleBehavior: "cycle"\|"none"`, `canDismiss: boolean \| (data, role) => Promise<boolean>`, `presentingElement` (card modal), `expandToScroll`, `focusTrap`, `keepContentsMounted`; `setCurrentBreakpoint()`, `getCurrentBreakpoint()`; `ionBreakpointDidChange`, `ionDragStart/Move/End` |
| `ion-popover` (23p) | `trigger`, `triggerAction: click\|hover\|context-menu`, `reference: trigger\|event`, `side`, `alignment`, `arrow`, `size: auto\|cover`, `dismissOnSelect`, nested-popover-aware `dismiss(_, _, dismissParentPopover)` |
| `ion-toast` (20p) | `message`, `header`, `icon`, `duration`, `position: top\|middle\|bottom`, `positionAnchor`, `layout: baseline\|stacked`, `swipeGesture: "vertical"`, `buttons: ToastButton[]` |
| `ion-loading` (15p) | `message`, `spinner`, `duration`, `showBackdrop` |

**`canDismiss`** is the standout API: a promise-returning guard on the component itself, which is how
"discard changes?" is expressed without the caller owning the dismissal.

### 2.3 Form controls (16)

| Component | p | Interface highlights |
|---|---|---|
| `ion-input` | **35** | `type` (12 HTML types), `label` + `labelPlacement: start\|end\|fixed\|stacked\|floating`, `fill: outline\|solid`, `shape: round`, `helperText`, `errorText`, `counter` + `counterFormatter`, `clearInput` + `clearInputIcon`, `clearOnEdit`, `debounce`, `autocomplete` (52-value union), `enterkeyhint`, `inputmode`; slots `start`/`end`/`label`; `setFocus()`, `getInputElement()` |
| `ion-textarea` | 29 | as above + `autoGrow`, `rows`, `cols`, `wrap` |
| `ion-select` | 23 | **`interface: "alert" \| "action-sheet" \| "popover" \| "modal"`** + `interfaceOptions`, `multiple`, `compareWith`, `selectedText`, `okText`/`cancelText` |
| `ion-searchbar` | 23 | `showClearButton`/`showCancelButton: never\|focus\|always`, `debounce`, `cancelButtonText/Icon`, `animated` |
| `ion-datetime` | **32** | `presentation: date\|time\|date-time\|time-date\|month\|year\|month-year`, `preferWheel`, `min`/`max`, `dayValues`/`hourValues`/`minuteValues`/`monthValues`/`yearValues`, `isDateEnabled(iso)=>boolean`, `highlightedDates`, `firstDayOfWeek`, `hourCycle`, `formatOptions`, `showDefaultButtons/Title/TimeLabel`, `multiple` |
| `ion-range` | 17 | `dualKnobs`, `pin` + `pinFormatter`, `snaps`, `ticks`, `step`, `activeBarStart`, `value: number \| {lower, upper}`; `ionKnobMoveStart/End` distinct from `ionChange`/`ionInput` |
| `ion-checkbox` / `ion-toggle` | 13 each | `checked`, `indeterminate` (checkbox), `enableOnOffLabels` (toggle), `labelPlacement`, `justify`, `alignment`, `helperText`, `errorText`, `required` |
| `ion-radio` / `ion-radio-group` | 8 / 6 | group owns `value`, `compareWith`, `allowEmptySelection`, `helperText`, `errorText` |
| `ion-input-otp` | 13 | `length=4`, `separators`, `shape: rectangular\|round\|soft`, `size`, `ionComplete` event, `setFocus(index?)` |
| `ion-input-password-toggle` | 4 | `showIcon`/`hideIcon` — a slot-in for `ion-input`'s `end` slot |
| `ion-picker` / `-column` / `-column-option` | 1/4/3 | the modern wheel; `ion-picker-column` has `prefix`/`suffix` slots |
| `ion-segment` / `-button` / `-view` / `-content` | 7/6/2/0 | `scrollable`, `swipeGesture`, `selectOnFocus`; `ion-segment-view` gives swipe-linked panels |

### 2.4 Lists & data display (17)

`ion-list` (`inset`, `lines`, `closeSlidingItems()`) · `ion-item` (14p: `button`, `detail`,
`detailIcon`, `lines`, `href`, slots `start`/`end`) · `ion-item-divider` (`sticky`) ·
`ion-item-group` · `ion-item-sliding` (`ionDrag`; `open(side)`, `close()`, `closeOpened()`,
`getOpenAmount()`, `getSlidingRatio()`) · `ion-item-options` (`side`, `ionSwipe`) · `ion-item-option`
(`expandable`, 6 slots) · `ion-list-header` · `ion-label` · `ion-note` · `ion-text` · `ion-avatar` ·
`ion-thumbnail` · `ion-badge` · `ion-chip` (`outline`) · `ion-skeleton-text` (`animated`) ·
`ion-reorder` / `ion-reorder-group` (`ionReorderStart/Move/End`, `ionItemReorder`, `complete()`).

`ion-infinite-scroll` (`threshold: "15%"`, `position`, `complete()`) + `ion-infinite-scroll-content`;
`ion-refresher` (`pullMin=60`, `pullMax=pullMin+60`, `pullFactor`, `closeDuration/snapbackDuration =
"280ms"`, `ionPullStart/ionPull/ionPullEnd/ionRefresh`, `getProgress()`) + `ion-refresher-content`.

### 2.5 Layout, feedback & misc (16)

`ion-grid`/`ion-row`/`ion-col` (**24 props on `ion-col`** — `size`/`offset`/`push`/`pull` × 6
breakpoints) · `ion-card` + `-header`/`-title`/`-subtitle`/`-content` · `ion-accordion` (`toggleIcon`,
`toggleIconSlot`, slots `header`/`content`) / `ion-accordion-group` (`multiple`, `expand:
compact|inset`, `readonly`, `animated`) · `ion-breadcrumb`/`-s` (`maxItems`, `itemsBeforeCollapse`,
`itemsAfterCollapse`) · `ion-fab` (`vertical`, `horizontal`, `edge`, `close()`) / `-button`
(`translucent`, `closeIcon`, `size: small`) / `-list` (`side`) · `ion-progress-bar`
(`type: determinate|indeterminate`, `buffer`, `reversed`) · `ion-spinner` (9 named spinners,
`paused`, `duration`) · `ion-img` (lazy: `ionImgWillLoad`/`ionImgDidLoad`/`ionError`) ·
`ion-backdrop` (`tappable`, `visible`, `stopPropagation`) · `ion-ripple-effect`
(`type: bounded|unbounded`, `addRipple(x, y)`).

---

## 3. React Native core — the primitive layer

The unstyled substrate. Prop counts here matter less than *which knobs exist*, because every one of
them is a behaviour some app needed.

| Component | Interface highlights |
|---|---|
| **View** | `style`, `onLayout`, `hitSlop: Insets \| number`, `pointerEvents: box-none\|none\|box-only\|auto`, `removeClippedSubviews`, `collapsable`, `needsOffscreenAlphaCompositing`, `renderToHardwareTextureAndroid`, `shouldRasterizeIOS`, + full `AccessibilityProps` + `GestureResponderHandlers` |
| **Text** | `numberOfLines`, `ellipsizeMode: head\|middle\|tail\|clip`, `adjustsFontSizeToFit` + `minimumFontScale`, `allowFontScaling` + `maxFontSizeMultiplier`, `selectable`, `dataDetectorType: phoneNumber\|link\|email\|all`, `dynamicTypeRamp` (11 iOS ramps), `onTextLayout`, `pressRetentionOffset`, `textBreakStrategy` |
| **Image** | `source`/`src`/`srcSet`, `resizeMode`, `defaultSource`, `loadingIndicatorSource`, `progressiveRenderingEnabled`, `tintColor`, `crossOrigin`, `referrerPolicy`, `onLoadStart/onLoad/onProgress/onError/onLoadEnd` |
| **TextInput** | ~60 props. Cross-platform: `value`/`defaultValue`, `onChangeText`, `multiline`, `secureTextEntry`, `keyboardType`, `inputMode`, `returnKeyType`, `enterKeyHint`, `autoComplete` (68-value union), `selection`, `selectTextOnFocus`, `caretHidden`, `submitBehavior`, `maxLength`, `onKeyPress`, `onContentSizeChange`, `onSelectionChange`. iOS-only: `clearButtonMode`, `clearTextOnFocus`, `keyboardAppearance`, `textContentType` (48 values), `passwordRules`, `enablesReturnKeyAutomatically`, `smartInsertDelete`, `rejectResponderTermination`. Android-only: `cursorColor`, `selectionHandleColor`, `importantForAutofill`, `disableFullscreenUI`, `showSoftInputOnFocus`, `textAlignVertical` |
| **ScrollView** | `contentContainerStyle`, `keyboardDismissMode: none\|interactive\|on-drag`, `keyboardShouldPersistTaps`, `stickyHeaderIndices` + `stickyHeaderHiddenOnScroll` + `invertStickyHeaders`, `pagingEnabled`, `snapToInterval`/`snapToOffsets`/`snapToAlignment`/`snapToStart`/`snapToEnd`, `disableIntervalMomentum`, `decelerationRate`, `refreshControl`, `scrollEventThrottle`, `maintainVisibleContentPosition: {minIndexForVisible, autoscrollToTopThreshold}`, `contentInsetAdjustmentBehavior`, `automaticallyAdjustKeyboardInsets`, `bounces`/`alwaysBounce*`, `overScrollMode`, `nestedScrollEnabled`, `fadingEdgeLength`, zoom (`min/max/zoomScale`, `pinchGestureEnabled`) |
| **FlatList** | `data`, `renderItem`, `keyExtractor`, `getItemLayout`, `initialNumToRender`, `initialScrollIndex`, `numColumns` + `columnWrapperStyle`, `onEndReached`(+threshold), `onRefresh`/`refreshing`, `onViewableItemsChanged` + `viewabilityConfig`, `extraData`, `removeClippedSubviews`, `inverted` |
| **SectionList** | + `sections`, `renderSectionHeader`/`Footer`, `stickySectionHeadersEnabled`, `SectionSeparatorComponent`, `onScrollToIndexFailed` |
| **Pressable** | `onPress/In/Out/Move`, `onLongPress` + `delayLongPress`, `onHoverIn/Out` + `delayHoverIn/Out`, `hitSlop`, `pressRetentionOffset`, `unstable_pressDelay`, `android_ripple`, `android_disableSound`, **`style` and `children` accept `(state: {pressed}) => …`** |
| **Modal** | `visible`, `animationType: none\|slide\|fade`, `transparent`, `backdropColor`, `onRequestClose`, `onShow`, `onDismiss`; iOS `presentationStyle: fullScreen\|pageSheet\|formSheet\|overFullScreen`, `supportedOrientations`, `allowSwipeDismissal`; Android `statusBarTranslucent`, `navigationBarTranslucent`, `hardwareAccelerated` |
| **Switch** | `value`, `onValueChange`, `disabled`, `trackColor: {true, false}`, `thumbColor`, `ios_backgroundColor` |
| **Button** | 2 own props — `title`, `color`. Deliberately minimal |
| **ActivityIndicator** | `animating`, `size: small\|large\|number`, `color`, `hidesWhenStopped` |
| **RefreshControl** | `refreshing`, `onRefresh`, `progressViewOffset`; iOS `tintColor`/`title`/`titleColor`; Android `colors[]`/`progressBackgroundColor`/`size`/`enabled` |
| **KeyboardAvoidingView** | `behavior: height\|position\|padding`, `keyboardVerticalOffset`, `enabled`, `contentContainerStyle` |
| **StatusBar** | `barStyle`, `hidden`, `animated`, + platform props |
| **InputAccessoryView** | `nativeID`, `backgroundColor` — the iOS above-keyboard toolbar |

Plus non-visual APIs that map to adaptv's `capabilities/` layer: `Alert`, `ActionSheetIOS`,
`ToastAndroid`, `Share`, `Linking`, `Clipboard`, `Vibration`, `Appearance`, `AppState`, `BackHandler`,
`Dimensions`, `Keyboard`, `PixelRatio`, `Platform`, `I18nManager`, `AccessibilityInfo`,
`PermissionsAndroid`, `LayoutAnimation`, `PanResponder`, `InteractionManager`, `Animated`.

---

## 4. `@expo/ui` — the sharpest signal in the document

### 4.1 The universal set — **18 components** (+ `RNHostView`, an RN-interop escape hatch)

This is Expo's own answer to "what is the minimum cross-platform component vocabulary?", shipped as
one API over SwiftUI, Jetpack Compose *and* web. Every component in it is, by construction, one Expo
judged worth the cost of tri-platform unification.

| Component | Props |
|---|---|
| **Host** | `matchContents: boolean \| {vertical, horizontal}`, `colorScheme`, `seedColor` (→ Material You palette / SwiftUI tint / CSS vars), `layoutDirection`, `ignoreSafeArea: 'all' \| 'keyboard'`, `useViewportSizeMeasurement`, `onLayoutContent` |
| **Text** | `children: string`, `textStyle: {fontSize, fontWeight, fontFamily, color, lineHeight, letterSpacing, textAlign}`, `numberOfLines` |
| **Button** | `label` \| `children`, `onPress`, `variant: filled \| outlined \| text` |
| **TextInput** | ~35 props — `value: ObservableState<string>` (a *native* state object, not a React value), `onChangeText`, `placeholder`, `multiline`, `secureTextEntry`, `keyboardType`, `inputMode`, `returnKeyType`, `enterKeyHint`, `autoComplete`, `autoCapitalize`, `selection: ObservableState<{start,end}>`, `selectTextOnFocus`, `caretHidden`, `selectionColor`, `cursorColor`, `onContentSizeChange`, `readOnly`, `rows`; ref: `focus/blur/clear/isFocused/setSelection` |
| **Switch** | `value`, `onValueChange`, `label`, `disabled` |
| **Checkbox** | `value`, `onValueChange`, `label`, `disabled` |
| **Slider** | `value`, `onValueChange`, `min=0`, `max=1`, `step`, `disabled` |
| **Picker** | `selectedValue`, `onValueChange`, `appearance: 'menu' \| 'wheel'`, `enabled`, `<Picker.Item label value>` |
| **BottomSheet** | `isPresented`, `onDismiss`, `snapPoints: ('half' \| 'full' \| {fraction} \| {height})[]`, `showDragIndicator` |
| **List** | `children`, `onRefresh: () => Promise<void>` — the promise drives the indicator |
| **ListItem** | `onPress`, `leading`, `trailing`, `supportingText`, + `<ListItem.Leading/.Trailing/.Supporting>` slot components |
| **FieldGroup** | settings-style grouped form; `<FieldGroup.Section title titleUppercase>`, `.SectionHeader`, `.SectionFooter`; exports `getFieldItemPosition(i, total) → leading\|middle\|trailing\|only` for corner radii |
| **Collapsible** | `isOpen`, `onOpenChange`, `label`, `labelStyle` |
| **Icon** | `name: SFSymbol \| ImageSource \| {ios, android}`, `size`, `color`; `Icon.select({ios, android})` is Babel-rewritten to a `Platform.OS` ternary so Metro can tree-shake the unused platform's asset |
| **Row** / **Column** | `alignment: start\|center\|end`, `spacing` |
| **Spacer** | `size`, `flexible` |
| **ScrollView** | `direction: vertical\|horizontal`, `showsIndicators` |

Shared base (`UniversalBaseProps`): `style`, `modifiers`, `onPress`, `onAppear`, `onDisappear`,
`disabled`, `hidden`, `testID`. `UniversalStyle` is a deliberately **narrow 15-key subset** of
`ViewStyle` — padding×7, `backgroundColor`, `borderRadius`/`borderWidth`/`borderColor`, `opacity`,
`width`, `height`. Nothing else crosses the bridge.

### 4.2 `swift-ui` — 50 direct SwiftUI bindings

`AccessoryWidgetBackground` · `Alert` · `BottomSheet` · `Button` · `Chart` · `ColorPicker` ·
`ConfirmationDialog` · `ContentUnavailableView` · `ContextMenu` · `ControlGroup` · `DatePicker` ·
`DisclosureGroup` · `Divider` · `Form` · `Gauge` · `GlassEffectContainer` · `Grid` · `Group` ·
`HStack`/`VStack`/`ZStack` · `Host` · `Image` · `Label` · `LabeledContent` · `LazyHStack`/`LazyVStack` ·
`Link` · `List` · `Mask` · `Menu` · `Namespace` · `Overlay` · `Picker` · `Popover` · `ProgressView` ·
`ScrollView` · `Section` · `SecureField` · `Shapes` · `ShareLink` · `Slider` · `Spacer` · `Stepper` ·
`SwipeActions` · `SyncToggle` · `TabView` · `Text` · `TextField` · `Toggle`

Plus **~120 modifier functions** (`@expo/ui/swift-ui/modifiers`) composed via a `modifiers={[…]}`
array: `frame`, `padding`, `cornerRadius`, `shadow`, `clipShape`, `border`, `opacity`, `blur`,
`glassEffect`, `matchedGeometryEffect`, `onTapGesture`, `onLongPressGesture`, `refreshable`,
`scrollDismissesKeyboard`, `scrollTargetBehavior`, `listRowBackground`, `listRowSeparator`,
`lineLimit`, `truncationMode`, `minimumScaleFactor`, `dynamicTypeSize`, `accessibility*` (9),
`buttonStyle`, `toggleStyle`, `controlSize`, `textFieldStyle`, `submitLabel`, `keyboardType`,
`textContentType`, `redacted`, `privacySensitive`, …

### 4.3 `jetpack-compose` — 49 direct Compose bindings

`AlertDialog` · `AnimatedVisibility` · `Badge` · `BadgedBox` · `BasicAlertDialog` · `Box` · `Button` ·
`Card` · `Carousel` · `Checkbox` · `Chip` · `Column` · `DatePicker` · `Divider` · `DockedSearchBar` ·
`DropdownMenu` · `ExposedDropdownMenuBox` · `FloatingActionButton` · `FlowRow` ·
`HorizontalFloatingToolbar` · `HorizontalPager` · `Host` · `Icon` · `IconButton` · `LazyColumn` ·
`LazyRow` · `ListItem` · `LoadingIndicator` · `ModalBottomSheet` · `MultiChoiceSegmentedButtonRow` ·
`NavigationBar` · `Progress` · `PullToRefreshBox` · `RadioButton` · `Row` · `SearchBar` ·
`SegmentedButton` · `Shape` · `SingleChoiceSegmentedButtonRow` · `Slider` · `Snackbar` · `Spacer` ·
`Surface` · `Switch` · `SyncSwitch` · `Text` · `TextField` · `ToggleButton` · `Tooltip`

---

## 5. The translation — how Apple's and Google's API became React props

The platform bindings in §4.2–4.3 don't match adaptv's architecture and never will: we render DOM,
they render SwiftUI and Compose. **But that is not why they're worth reading.** They are the only
large, recent, professionally-maintained body of work that answers a question adaptv faces
constantly: *given a high-level UI decision made by Apple's or Google's framework team, what does a
good React interface for it look like?*

Both toolkits are declarative but **not** JSX-shaped — SwiftUI is a chained builder DSL over value
types with property-wrapper state, Compose is a chained `Modifier` over composable functions. Expo
had to map both onto props and children. These are the mappings they landed on.

### 5.1 A chained builder DSL → an ordered array of serialized configs

SwiftUI's chain is order-significant (`.padding().background()` ≠ `.background().padding()`), so it
can't collapse into a prop bag. Expo's answer:

```swift
Text("hi").padding(8).background(.red).cornerRadius(12)      // SwiftUI
```
```tsx
<Text modifiers={[padding({ all: 8 }), background('red'), cornerRadius(12)]}>hi</Text>
```

Every modifier is a plain function returning `ModifierConfig = { $type: string, …params }`, built by
one factory:

```ts
createModifier(type: string, params?: Record<string, any>): ModifierConfig
createModifierWithEventListener(type, eventListener: (args) => void, params?): ModifierConfig
```

**Array order = chain order.** ~120 such functions on the SwiftUI side, ~40 on the Compose side
(`align`, `alpha`, `background`, `blur`, `border`, `clickable`, `clip`, `combinedClickable`,
`fillMaxSize`, `graphicsLayer`, `imePadding`, `offset`, `padding`, `rotate`, `semantics`, `shadow`,
`size`, `toggleable`, `weight`, `zIndex`, …) — the same trick, because Compose's `Modifier` is the
same shape of problem.

Two consequences worth naming:

- **Gestures are modifiers, not props.** `onTapGesture`, `onLongPressGesture`, `onGeometryChange`,
  `refreshable` all go in the array, via `createModifierWithEventListener` — a config object can
  carry a function reference across the bridge. SwiftUI treats gestures as view modifiers; Expo did
  not "fix" that into `onPress`.
- **The array is the typed escape hatch.** `modifiers` from the wrong platform are *ignored at
  runtime*, not an error. That's what lets the universal layer (§4.1) keep a 15-key `style` and still
  never be a dead end.

> **For adaptv:** our target isn't a builder chain — CSS is already a declarative property bag, so
> the direct translation doesn't apply. What *does* transfer is the shape: **narrow typed core +
> open, ordered, platform-tagged escape hatch that degrades to a no-op.** That's a better answer than
> either "expose everything" or "you're stuck".

### 5.2 `@State` / `@Binding` → a native shared object, not React state

The sharpest finding in the whole surface. A native control expects to own its own value at
display rate; a React round-trip per frame doesn't hold up. So Expo shipped **two variants of the
same control**:

```ts
// the React-idiomatic one
ToggleProps      { isOn?: boolean;                    onIsOnChange?:     (isOn: boolean) => void }
// the native-owned one
SyncToggleProps  { isOn:  ObservableState<boolean>;   onIsOnChangeSync?: (isOn: boolean) => void }
```

```ts
type ObservableState<T> = SharedObject & {
  value: T
  get(): T
  set(value: T): void
  onChange: ((value: T) => void) | null
}
declare function useNativeState<T>(initialValue: T): ObservableState<T>
declare function useWorkletProp(callback?, propName?): SharedObject | null
```

Compose gets the identical pair (`Switch` / `SyncSwitch`). `TextInput` goes further — both
`value?: ObservableState<string>` **and** `selection?: ObservableState<{start, end}>` are native
state, so typing and caret movement never touch React. `useWorkletProp` pushes the same idea onto the
worklet thread.

> **For adaptv this is the closest thing to a peer decision in the document.** A gesture-driven
> drawer cannot re-render React per frame either, and adaptv's answer is the same *shape* — the
> gesture engine writes transforms/CSS vars directly and React learns about it at commit boundaries.
> Different substrate, identical reasoning. Worth citing when that design gets questioned.

### 5.3 `withAnimation { … }` → a function wrapping the mutation, with a chainable value

The one place Expo *kept* a chain, because SwiftUI's `Animation` is itself a chainable value type:

```ts
withAnimation(animation: ChainableAnimationType | null, body: () => void,
              completion?: () => void,
              completionCriteria?: 'logicallyComplete' | 'removed'): void
// spring({ response, dampingFraction, bounce }).delay(0.1).repeat({ repeatCount: 2, autoreverses: true })
```

The underlying `AnimationObject` is a flat, serializable union of every SwiftUI curve parameter —
`type: 'easeInOut' | 'easeIn' | 'easeOut' | 'linear' | 'spring' | 'interpolatingSpring' | 'default'`
plus `duration`, `response`, `dampingFraction`, `blendDuration`, `bounce`, `mass`, `stiffness`,
`damping`, `initialVelocity`, `delay`, `repeatCount`, `autoreverses`. **Rule: chain where the source
API's own value is chainable; flatten everywhere else.**

### 5.4 A property wrapper token (`@Namespace`) → a React provider

SwiftUI's shared-element transition needs two views to agree on a namespace, which Swift expresses as
a `@Namespace` property wrapper. In JSX that becomes exactly what you'd guess:

```tsx
<Namespace id="hero">
  <Image modifiers={[matchedGeometryEffect({ id: 'photo', namespace: 'hero' })]} />
</Namespace>
```

Provider-supplies-a-token is the idiomatic React answer to a Swift property wrapper. Same story for
`Host`'s `seedColor`, which propagates as a SwiftUI environment tint / Material You palette /
CSS custom properties depending on platform.

### 5.5 Modifier-configured sheets → flattened into props, *but only in the universal layer*

This contrast is the clearest single illustration of the whole translation exercise. SwiftUI
configures a sheet through modifiers on its content, and `swift-ui` preserved that faithfully:

```ts
presentationDetents(detents: PresentationDetent[], opts?: { selection?, onSelectionChange? })
presentationDragIndicator('automatic' | 'visible' | 'hidden')
presentationBackgroundInteraction('automatic'|'enabled'|'disabled'|{type:'enabledUpThrough', detent})
presentationBackground(color)
interactiveDismissDisabled(isDisabled?)
```

The **universal** `BottomSheet` throws all of that away and exposes four props —
`isPresented`, `onDismiss`, `snapPoints`, `showDragIndicator`. Same team, same release, opposite
decision, and the reason is the audience: the binding layer's user is reading Apple's docs and wants
1:1; the universal layer's user wants the 90% case in four props.

### 5.6 "Enum with one parametrized case" → a union with an object variant

A consistent trick across every surface, because neither TS enums nor string unions can carry a
payload:

| Source | Result |
|---|---|
| SwiftUI `.fraction(0.3)` / `.height(200)` | `PresentationDetent = 'medium' \| 'large' \| {fraction} \| {height}` |
| the same, flattened | `SnapPoint = 'half' \| 'full' \| {fraction} \| {height}` |
| SwiftUI `.enabledUpThrough(detent)` | `'automatic' \| 'enabled' \| 'disabled' \| {type:'enabledUpThrough', detent}` |
| Compose `Arrangement.spacedBy(8)` | `HorizontalArrangement = 'start' \| … \| 'spaceEvenly' \| {spacedBy: number}` |
| RN (same idea, independently) | `fadingEdgeLength?: number \| {start, end}`, `hitSlop?: Insets \| number` |

### 5.7 Trailing closures / ViewBuilder slots → namespaced compound children

SwiftUI takes several `@ViewBuilder` closures; Compose takes several composable lambdas. JSX has one
`children`. The answer everywhere is namespaced marker components:

`ContextMenu.Trigger` / `.Preview` / `.Items` · `SwipeActions.Actions({edge, allowsFullSwipe})` ·
`TabView.Tab` · `List.ForEach` · `Picker.Item` · `FieldGroup.Section` / `.SectionHeader` /
`.SectionFooter` · `ListItem.Leading` / `.Trailing` / `.Supporting` · `Link.Menu` / `.MenuAction` /
`.Trigger` / `.Preview`.

And in the universal layer, the same slots also have **shorthand props** (`leading`, `trailing`,
`supportingText`) with the slot component winning when both are present — both ergonomics from one
API.

### 5.8 Naming follows the audience, not the implementation

The bindings keep Apple's vocabulary **verbatim**: `isPresented`, `isOn`, `systemImage`,
`leading`/`trailing` (never left/right), `Alignment` with all 15 SwiftUI cases including
`centerFirstTextBaseline`, `FrameProps` with `idealWidth`/`idealHeight`. A developer with Apple's
documentation open can read it straight across — the Apple doc *is* the doc.

The universal layer translates the same concepts into React vocabulary: `value` + `onValueChange`,
`label`, `disabled`, `alignment: 'start' | 'center' | 'end'`.

**One team made both choices deliberately in the same package.** The lesson isn't "use native names"
or "use web names" — it's that the naming decision is downstream of who is expected to be reading
the other documentation.

### 5.9 What adaptv should take from §5

1. Copy the **narrow-core + typed-escape-hatch-that-no-ops** shape (§5.1), not the modifier array
   itself.
2. The **native-owned-state variant** (§5.2) is independent confirmation of adaptv's
   gesture-engine-writes-the-DOM design. Cite it.
3. Flatten by default; **chain only where the underlying value is genuinely chainable** (§5.3).
4. **Union-with-object-variant** (§5.6) for every "enum with one parametrized case" — this should be
   a house rule; `SnapPoint`-style `'half' | 'full' | {fraction}` is exactly what an adaptv sheet API
   wants.
5. **Namespaced compound children + shorthand props for the common case** (§5.7) — adaptv's
   `Swipeable` already uses slot constants (`SWIPEABLE_LEFT_ACTIONS_SLOT`); compound components are
   the more discoverable version of the same idea.
6. Pick a naming register **once**, based on who the reader is. adaptv's reader is a web developer,
   which argues for `open`/`checked`/`start`/`end` over `isPresented`/`isOn`/`leading`/`trailing` —
   but the decision should be recorded, not drifted into.

---

## 6. Expo SDK view components

The capability-backed views. 123 modules ship in SDK 57; these are the ones that render.

| Package | Component | Props |
|---|---|---|
| **expo-image** | `Image`, `ImageBackground` | `source`, `placeholder` (blurhash/thumbhash/SF Symbol string), `contentFit`, `contentPosition`, `transition`, `cachePolicy`, `priority`, `recyclingKey`, `blurRadius`, `tintColor`, `allowDownscaling`, `decodeFormat`, `preferHighDynamicRange`, `enableLiveTextInteraction`, `autoplay`, `sfEffect`, `responsivePolicy`, `onLoadStart/onLoad/onProgress/onError/onLoadEnd/onDisplay`; hooks `useImage`, `useBlurhash`, `useThumbhash` |
| **expo-blur** | `BlurView`, `BlurTargetView` | `intensity`, `tint`, `blurReductionFactor`, `experimentalBlurMethod`, `blurTarget` |
| **expo-glass-effect** | `GlassView`, `GlassContainer` | `glassEffectStyle`, `tintColor`, `isInteractive`, `colorScheme`; `isLiquidGlassAvailable()` |
| **expo-linear-gradient** | `LinearGradient` | `colors`, `locations`, `start`, `end`, `dither` |
| **expo-mesh-gradient** | `MeshGradientView` | `columns`, `rows`, `points`, `colors`, `smoothsColors`, `mask`, `resolution` |
| **expo-symbols** | `SymbolView` | `name`, `fallback`, `type`, `scale`, `weight`, `colors`, `size`, `tintColor`, `animationSpec` |
| **expo-video** | `VideoView`, `useVideoPlayer` | `player`, `nativeControls`, `contentFit`, `allowsPictureInPicture`, `startsPictureInPictureAutomatically`, `fullscreenOptions`, `showsTimecodes`, `requiresLinearPlayback`, `surfaceType`, `playsInline`, `onFullscreenEnter/Exit`, `onFirstFrameRender`, `onPictureInPictureStart/Stop` |
| **expo-camera** | `CameraView` | `facing`, `flash`, `zoom`, `mode`, `mute`, `mirror`, `autofocus`, `active`, `videoQuality`, `enableTorch`, `barcodeScannerSettings`, `onCameraReady`, `onBarcodeScanned`, `onMountError` |
| **expo-maps** | `AppleMapsView`, `GoogleMapsView` | `cameraPosition`, `markers`, `polylines`, `polygons`, `circles`, `uiSettings`, `properties`, `onMapClick/onMarkerClick/onCameraMove` |
| **expo-checkbox** | `Checkbox` | `value`, `onValueChange`, `color`, `disabled` |
| **expo-live-photo** | `LivePhotoView` | `source`, `isMuted`, `contentFit`, `useDefaultGestureRecognizer`, playback callbacks |

The rest of the 123 are capability modules (haptics, location, sensors, secure-store, notifications,
file-system, sqlite, …) — adaptv's `src/capabilities/` equivalent. They are inventoried separately in
**`docs/research/capability-surface.md`**, alongside RN's non-visual APIs and the official Capacitor plugin roster.

---

## 7. `expo-router` — navigation primitives

Worth reading closely, because this is the layer adaptv already competes in.

| Primitive | Interface |
|---|---|
| **`Link`** | `href: Href` (typed routes), `replace`, `push`, `dismissTo`, `asChild`, `relativeToDirectory`, `withAnchor`, `prefetch`, `target`/`rel`/`download` on web; extends `TextProps` |
| **`Link.Preview`** | iOS long-press peek — `style: {width, height}` |
| **`Link.Menu` / `Link.MenuAction`** | native context menu on a link: `title`, `subtitle`, `icon: SFSymbol`, `destructive`, `isOn`, `inline`, `displayAsPalette`, `elementSize` |
| **`Link.Trigger`**, **`Link.AppleZoom`** | slot markers for the preview/zoom transition |
| **`Redirect`** | `href` |
| **`Stack`** | `Stack.Screen` with `options`; native header primitives — `StackHeaderProps`, `StackScreenBackButtonProps`, `StackSearchBarProps`, `StackToolbar*` (Button, Icon, Label, Menu, MenuAction, Badge, Spacer, SearchBarSlot, View) |
| **`Tabs`** / **`NativeTabs`** | `NativeTabTrigger` with `icon` (`sf` / `drawable` / `src`), `selectedIcon`, `badgeValue`, `role`, `disablePopToTop`, `disableScrollToTop`; host-level `minimizeBehavior`, `blurEffect`, `labelVisibilityMode`, `sidebarAdaptable`, `tabBarRespectsIMEInsets`, `disableTransparentOnScrollEdge`, `indicatorColor`, `rippleColor` |
| **Primitives** | `Badge`, `Icon`, `Label`, `VectorIcon` — declarative slot children for headers/tabs |
| **`Slot`**, **`Navigator`** | headless layout composition |
| **Hooks** | `useRouter`, `usePathname`, `useSegments`, `useLocalSearchParams`, `useGlobalSearchParams`, `useNavigation`, `useFocusEffect`, `useIsFocused`, `useLoaderData`, `useCurrentRouteInfo`, `useScrollToTop`, `useTheme`, `useSitemap` |
| **Other** | `ErrorBoundary`, `SuspenseFallback`, `Unmatched`, `Sitemap`, `SplashScreen`, `ThemeProvider` |

---

## 8. Convergence — what both ecosystems independently shipped

The ranking rule: a component that exists in **Ionic *and* `@expo/ui` universal** is the strongest
signal (both teams paid for cross-platform unification). Next strongest: Ionic + *both* `swift-ui`
and `jetpack-compose` (both native toolkits have it as a first-class control). Weakest: one
ecosystem only.

| Component | Ionic | RN core | `@expo/ui` universal | swift-ui | compose | expo-router | adaptv today |
|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| Button | ✅ | ✅ | ✅ | ✅ | ✅ | | `useButton` |
| Text | ✅ | ✅ | ✅ | ✅ | ✅ | | `Text` ✅ (§8.1) |
| TextInput / Input | ✅ | ✅ | ✅ | ✅ | ✅ | | `input` + `text-area` |
| Switch / Toggle | ✅ | ✅ | ✅ | ✅ | ✅ | | `useSwitch` |
| Checkbox | ✅ | (expo-checkbox) | ✅ | ✅ | ✅ | | `useCheckbox` |
| **Slider / Range** | ✅ | | ✅ | ✅ | ✅ | | **—** |
| Picker / Select | ✅ | | ✅ | ✅ | ✅ | | `select` (menu) + `wheel-column` (wheel) ✅ |
| List + row | ✅ | ✅ | ✅ | ✅ | ✅ | | `List` (virtualized) |
| ScrollView | ✅ | ✅ | ✅ | ✅ | ✅ | | `ScrollView` |
| Bottom sheet / Modal | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | `Drawer` |
| Pull-to-refresh | ✅ | ✅ | ✅ (`List.onRefresh`) | ✅ (modifier) | ✅ | | `PullToRefresh` |
| Icon | (ionicons) | | ✅ (native only — web `index.tsx` returns `null`) | ✅ | ✅ | ✅ | `Icon` ✅ (no bundled set) |
| **Collapsible / Accordion** | ✅ | | ✅ | ✅ | | | **—** |
| Grouped form / settings list | ✅ (`ion-list inset`) | | ✅ (`FieldGroup`) | ✅ (`Form`/`Section`) | | | `FieldGroup` |
| **Alert dialog** | ✅ | ✅ (`Alert`) | | ✅ | ✅ | | **—** |
| **Action sheet / confirmation** | ✅ | ✅ (`ActionSheetIOS`) | | ✅ | | | **—** |
| **Toast / Snackbar** | ✅ | ✅ (`ToastAndroid`) | | | ✅ | | **—** |
| Spinner / activity | ✅ | ✅ | | ✅ (`ProgressView`) | ✅ | | `Spinner` ✅ (inline; no overlay) |
| **Progress bar** | ✅ | | | ✅ | ✅ | | **—** |
| **Tab bar** | ✅ | | | ✅ (`TabView`) | ✅ (`NavigationBar`) | ✅ | **—** |
| **Nav header / toolbar** | ✅ | | | | ✅ (`…FloatingToolbar`) | ✅ (`Stack` header) | **—** |
| **Search bar** | ✅ | | | | ✅ | ✅ (`StackSearchBar`) | **—** |
| **Segmented control** | ✅ | | | ✅ (`Picker`) | ✅ | | **—** |
| **Menu / popover / context menu** | ✅ | | | ✅ ×3 | ✅ | ✅ (`Link.Menu`) | `Dropdown` ✅ |
| **Date/time picker** | ✅ | | | ✅ | ✅ | | **—** |
| **Badge** | ✅ | | | | ✅ | ✅ | **—** |
| **Divider** | ✅ | | | ✅ | ✅ | | **—** |
| **FAB** | ✅ | | | | ✅ | | **—** |
| **Card / Surface** | ✅ | | | | ✅ | | **—** |
| **Chip** | ✅ | | | | ✅ | | **—** |
| **Swipe actions on a row** | ✅ | | | ✅ | | | `Swipeable` |
| Side menu / drawer | ✅ | ✅ (Android) | | | | | `Drawer` |
| Image | ✅ | ✅ | | ✅ | | | `Image` ✅ compound + `useImage` (§8.1) |
| Skeleton | ✅ | | | (`redacted`) | | | **—** |
| Reorderable list | ✅ | | | ✅ (modifier) | | | **—** |
| Keyboard avoidance | ✅ (shims) | ✅ | | ✅ (modifier) | | | `AvoidKeyboard` |
| Stepper | | | | ✅ | | | — |
| Grid / Row / Col | ✅ | (flexbox) | ✅ | ✅ | ✅ | | — (CSS) |

### The read

> **The actionable form of this list now lives at**
> [`../roadmap/component-gaps.md`](../roadmap/component-gaps.md). The four tiers below are the
> reasoning; that file is the remainder, kept current as things ship.

**Tier 1 — in the universal set *and* Ionic, and missing from adaptv:**
`Slider` · `Select`/`Picker` (menu appearance, not just the wheel) · `Collapsible` · `Icon`.

These are the ones both teams paid the tri-platform tax for. `Slider` and a real `Select` are the
clearest holes in adaptv's form-control set — it has button/input/textarea/checkbox/switch and stops.
The grouped-settings form shipped 2026-09-02 as `FieldGroup` (`src/components/field-group.tsx`);
what it locks and what it refuses is in `../roadmap/component-gaps.md`.

**Tier 2 — every native toolkit has it, Ionic has it, adaptv has none of it: the feedback layer.**
`Alert` · `ActionSheet` · `Toast` · `Spinner` · `ProgressBar`. Note that Ionic's five overlays all
share one interface (§2.2), so this is plausibly *one* overlay engine plus five thin presets rather
than five components — and adaptv's `Drawer` is already an overlay with a gesture engine behind it.

**Tier 3 — the app frame.** `TabBar` · nav header/toolbar with back button and large-title collapse ·
`SearchBar`. Both ecosystems ship these, and both treat them as *routing-level* concerns
(`ion-tabs`/`ion-router-outlet`; `expo-router`'s `Stack`/`NativeTabs`) rather than free-standing
components. adaptv owns its router, so this is the piece with the most leverage and the most design
work — it can't be lifted from either API directly.

**Tier 4 — display chrome.** `Badge` · `Divider` · `Card` · `Chip` · `Skeleton` · `FAB` · `Avatar`.
Cheap, high-frequency, low-risk. Mostly CSS in a DOM framework.

**Deliberately absent from adaptv's needs:** the layout family (`Row`/`Column`/`Spacer`/`HStack`/
`Grid`/`ion-col`'s 24 props) exists because SwiftUI/Compose have no CSS and Ionic predates CSS grid.
adaptv is DOM + CSS; flexbox already is that API, and there is no platform quirk a `<Row>` would
absorb that flexbox does not already handle.

### 8.1 ⚠︎ Correction — the test for whether a primitive should exist

An earlier draft of this section also listed **`Text`** as absent, on the grounds that `<p>`/`<span>`
with classes is the web-native answer and `@expo/ui`'s `Text` only exists because there is no DOM
underneath it. **That reasoning was on the wrong axis and the conclusion was wrong.**

It asked *what does the API need to express?* — which is the right question for SwiftUI, where `Text`
is the only way to render a glyph. For a framework whose value proposition is absorbing platform bugs,
the question is *where does the framework get somewhere to stand?* Every primitive is one more place
adaptv is on the path when a quirk fires, and the developer who most needs the fix is exactly the one
who will never apply it by hand.

> 🔒 **The test: ship a primitive when there are at least two platform quirks it would own.**
> Fewer than that and it is a styled element with an import cost — pure tax, more API to document and
> maintain for nothing.

**`Text` passes**, on: iOS Dynamic Type (Ionic does it in five lines, and the `font` **shorthand** is
required — `font-size` does not work, `docs/decisions/prior-art.md §10`), `text-size-adjust` on rotation, line
clamping, and per-instance selection semantics rather than a global reset plus an opt-out utility —
which is exactly React Native's model, down to the prop being named `selectable`.

**It does *not* get the iOS magnifier**, contrary to an earlier claim here. `useSuppressTextMagnifier`
is already mounted app-wide by the shell, and it *must* be: it is a document-level double-tap
interceptor that skips `.clickable` controls, and the loupe is not text-only. §8.2.

**`Image` passes too** — reserving its box against layout shift (`VISION.md §2.1`), decode hints,
the iOS long-press callout, drag suppression, and a build-time placeholder pipeline. See
`docs/design/image.md`.

**Two costs to weigh before adding any of them.** A primitive nobody reaches for buys nothing — if
`<p>` works and `<Text>` is optional, most people write `<p>` and Dynamic Type still never happens, so
the value is made in docs and the playground, not in code. And a wrapper costs a component layer per
node: in a virtualised list of 1000 rows × 3 texts that is measurable, and should be measured rather
than assumed.

### 8.2 The layer that is already invisible

adaptv's shell mounts these with no consumer involvement, and most of them are private *as exports*
while running on every app — a distinction easy to miss:

```
useSyncTheme · useStatusBar · useAndroidBackButton · useCaretRepaint
useRegisterPwaServiceWorker · useSuppressTextMagnifier · useFreezeViewport
```

> ⟨corrected 2026-08-30⟩ This paragraph used to claim *"none of them appear in `hooks.index.ts`"*.
> **Three of the seven do** — `useAndroidBackButton`, `useFreezeViewport` and `useStatusBar` are all
> exported from `src/interface/hooks.index.ts`, and being publicly exported is correct for them: an
> app has legitimate reasons to register its own back handler, freeze the viewport, or read the
> status bar. The other four are genuinely internal. This doc flagged its own history of getting
> this wrong two lines above the claim, and then got it wrong again — so: **read the barrel.**

This is the "magic" tier working as intended, and it is the reason a primitive does not need to own
every quirk — anything document-wide belongs here instead.

### 8.3 `Button` vs `Pressable`

Both exist and they share one press implementation (`usePressCore`), so the difference is everything
else:

| | `Pressable` | `Button` |
|---|---|---|
| Element | `render` prop — any | `<button type="button">` |
| Semantics | none | keyboard activation, form participation, screen-reader role, free |
| Haptics | no | yes, including the iOS-web transducer |
| Slots | no | `.Leading` `.Trailing` `.Text` |
| Imperative handle | no | `ButtonHandle` — `disabled`, `focus()` |

Reach for `Pressable` when a `<div>`/`<li>`/`<article>` must be pressable; `Button` when it is a
button. That one line has to be in the docs, or it is the two-ways problem again.

---

## 9. Interface conventions worth copying

Independent of *which* components get built, these are the API-shape decisions both teams converged
on, with the reasoning visible in the types.

**From Ionic:**

1. **One overlay contract, five presets.** `isOpen` + `trigger` + `present()`/`dismiss()` +
   `willPresent/didPresent/willDismiss/didDismiss` + `onWillDismiss<T>()`/`onDidDismiss<T>()`,
   identical across all eight overlays. Learn it once.
2. **`canDismiss: boolean | ((data, role) => Promise<boolean>)`.** The dismissal guard belongs to the
   component, not the caller. This is how "unsaved changes?" is expressed without the parent owning
   dismissal state.
3. **The form-field vocabulary is uniform**: `label` + `labelPlacement` + `helperText` + `errorText` +
   `fill` + `shape` + `justify` + `alignment` appear on input, textarea, select, checkbox, toggle,
   radio-group, range. One mental model, seven components.
4. **`interface: "alert" | "action-sheet" | "popover" | "modal"` on `ion-select`.** The *presentation*
   of a select is a prop, not a different component. Very reusable idea.
5. **`debounce` as a first-class prop** on every text-ish control (`ion-input`, `ion-textarea`,
   `ion-searchbar`, `ion-range`) — not a hook the caller has to remember.
6. **`ionChange` vs `ionInput` are distinct events** everywhere, and `ion-range` adds
   `ionKnobMoveStart`/`ionKnobMoveEnd` — commit vs. live vs. gesture-boundary are three different
   questions.
7. **Named slots over prop-drilled render functions** (`start`/`end`/`label` on inputs;
   `start`/`secondary`/`primary`/`end` on toolbars). JSX children beat `renderLeft` props.
8. **Two props appear on most of the catalogue**: `mode: "ios" | "md"` on **53 of 95** components and
   the `color` design-token union (`primary`/`secondary`/`tertiary`/`success`/`warning`/`danger`/
   `light`/`medium`/`dark` + `string & Record<never, never>` so custom tokens still autocomplete) on
   **42 of 95**. Platform styling and theming are per-component overrides, not globals only.

**From Expo:**

9. **Controlled pairs, always**: `value` + `onValueChange`. No `checked`/`onChange` drift across
   components, no uncontrolled fallback in the universal set.
10. **A narrow `style` and an explicit escape hatch.** `UniversalStyle` is 15 keys; anything beyond it
    goes through `modifiers={[…]}`, which is *typed per platform and ignored on the wrong one*. The
    cross-platform API stays small without being a dead end.
11. **`testID` on every single component.** Non-negotiable, uniform.
12. **Compound components as slot markers**: `<ListItem.Leading>`, `<FieldGroup.Section>`,
    `<Picker.Item>`, `<Link.Menu>` — with *shorthand props* (`leading`, `trailing`,
    `supportingText`) for the common case and the slot component overriding it when present. Both
    ergonomics in one API.
13. **`onRefresh: () => Promise<void>`** — the returned promise drives the indicator. No
    `refreshing` boolean to keep in sync (contrast RN's `RefreshControl`, which needs both).
14. **`@platform` doc annotations on individual props**, plus documented fallbacks
    ("iOS: `'visible-password'` falls back to the default keyboard"). Degradation is specified, not
    discovered.
15. **`Icon.select({ios, android})` over `{ios, android}` object literals** — a Babel plugin rewrites
    it to a `Platform.OS` ternary so the unused platform's asset tree-shakes out. Worth remembering
    that a *function-shaped* API can be compiled away where an object literal can't.
16. **Helper exports alongside components** — `getFieldItemPosition(index, total)` ships from
    `FieldGroup` so consumers can build their own rows with correct grouped-list corner radii.
    adaptv exports the same helper, but only for rows that are not DOM siblings (a virtualised
    list); sibling rows spell the corners with `first:` / `last:` / `only:`, because
    `../decisions/styling.md §5.4.1` forbids a `data-position` for what Tailwind already says.

---

## 10. Where this sits

- `docs/research/capability-surface.md` — the device-API counterpart: Expo SDK modules, RN non-visual APIs, the
  official Capacitor plugin roster, and adaptv's `src/capabilities/` gap.
- `docs/decisions/prior-art.md` — the same two codebases read for *internals* (gesture arbitration, transition
  constants, keyboard guards). This doc is the *surface* counterpart; neither supersedes the other.
- `docs/decisions/positioning.md` — the tooling/dev-loop comparison. Component parity is a separate axis.
- `docs/design/behaviors.md` / `docs/guides/cookbook.md` — where any component built from §7 should land.

**Raw extracts** (regenerable, not committed): the full 1015-line Ionic API dump, the RN prop-interface
extract, and the Expo view-props extract were produced by scripts in the session scratchpad from the
package versions pinned at the top. Re-run against a newer `docs.json` to diff a future Ionic release.

## 11. Edge fades — what every platform that ships them agreed on

Surveyed while reworking `ScrollView`'s edge fades (2026-07-30). The convergence is
unusually tight, and one of the agreements is a *negative* one worth recording.

| | which edges | depth | colour | fades out when parked |
|---|---|---|---|---|
| Android `View` | `requiresFadingEdge="vertical\|horizontal"` | `fadingEdgeLength` px | none | **yes** — `getTopFadingEdgeStrength()` returns 0→1 from the scroll offset, since API 14 |
| React Native | all-or-nothing, **Android only** | `fadingEdgeLength` px | none | yes (and [regressed](https://github.com/facebook/react-native/issues/55029)) |
| SwiftUI (iOS 26) | `.scrollEdgeEffectStyle(_:for:)`, **per edge** | not exposed | not exposed | yes |
| Flutter `fading_edge_scrollview` | `gradientFractionOnStart` / `OnEnd` | fraction | none | yes |
| shadcn `scroll-fade` | `scroll-fade-s` / `-e` / `-t` / `-b` / `-l` / `-r` | `scroll-fade-<n>`, `--scroll-fade-size` | none | yes, via `animation-timeline: scroll()` |

Three conclusions adaptv took:

1. **Per-edge, named logically.** SwiftUI and shadcn both landed on it; Android and RN
   offer all-or-nothing and are the older designs. `start`/`end` (not `top`/`bottom`)
   means one pair of names covers both orientations and RTL. → `fade={true|"start"|"end"}`.
2. **Nobody exposes a colour**, because everybody uses a mask rather than an overlay.
   A mask dissolves the content, so whatever is behind shows through and there is no
   value to keep in sync with the theme — over an image or a glass bar a coloured band
   is simply wrong. adaptv's old `edgeClassName="bg-background"` was the odd one out
   and is gone.
3. **Parked auto-hide is table stakes**, not a refinement — it is what makes a deep
   fade usable at all. Android has had it since 2011.

The one place adaptv deliberately diverges from the newest prior art is the driver.
shadcn gets the parked behaviour from scroll-driven animations, which is Safari 26+;
adaptv's floor is iOS 18, so a CSS-only version would work on Android and silently do
nothing on most iPhones. One JS driver on every target instead — `use-scroll-edge-fade.ts`,
writing the same 0→1 strengths Android computes.
