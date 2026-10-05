import {
  Button,
  Checkbox,
  Divider,
  Drawer,
  Dropdown,
  ExternalLink,
  Fab,
  FieldGroup,
  Icon,
  Image,
  Input,
  Link,
  List,
  Offline,
  Pressable,
  ProgressBar,
  PullToRefresh,
  PwaSplashOverlay,
  RadioGroup,
  ScrollView,
  Select,
  Skeleton,
  Slider,
  Spinner,
  Switch,
  Text,
  TextArea,
  UiNotFound,
  View,
  WheelColumn,
} from "@arrzdev/adaptv/components"
import { createFileRoute, useLocation } from "@arrzdev/adaptv/router"
import type { CSSProperties, ReactNode } from "react"
import labPhotoTallUrl from "@/assets/lab-photo-tall.jpg?url"
import { LabBrief } from "@/components/lab/lab-brief"
import { LabSection } from "@/components/lab/lab-kit"
import { LabPage } from "@/components/lab/lab-page"
import type {
  Dialect,
  PrecedenceCase,
} from "@/routing/pages/lab/style-precedence.cases"
import {
  CASES,
  classesFor,
  DIALECTS,
} from "@/routing/pages/lab/style-precedence.cases"
import "@/routing/pages/lab/style-precedence.css"

export const Route = createFileRoute("/_providers/lab/style-precedence")({
  component: LabStylePrecedencePage,
})

const WHEEL_ITEMS = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
]

/** `cls` is the consumer's class for this row and dialect; `undefined` when bare. */
const RENDER: Record<string, (cls: string | undefined) => ReactNode> = {
  pressable: (cls) => <Pressable className={cls}>press</Pressable>,
  button: (cls) => <Button className={cls}>button</Button>,
  "button-leading": (cls) => (
    <Button>
      <Button.Leading className={cls}>+</Button.Leading>
      <Button.Text>label</Button.Text>
    </Button>
  ),
  "button-text": (cls) => (
    <Button>
      <Button.Text className={cls}>label</Button.Text>
    </Button>
  ),
  fab: (cls) => (
    <Fab aria-label="fab" className={cls}>
      +
    </Fab>
  ),
  link: (cls) => (
    <Link to="/lab" className={cls}>
      link
    </Link>
  ),
  "external-link": (cls) => (
    <ExternalLink href="https://example.com" className={cls}>
      external
    </ExternalLink>
  ),
  "text-selectable": (cls) => (
    <Text selectable className={cls}>
      selectable text
    </Text>
  ),
  icon: (cls) => (
    <Icon render={<svg viewBox="0 0 1 1" />} className={cls} />
  ),
  view: (cls) => (
    <View safe="bottom" className={cls}>
      view
    </View>
  ),
  "scroll-view": (cls) => (
    <ScrollView className={cls} style={{ height: 40 }}>
      scroll
    </ScrollView>
  ),
  list: (cls) => (
    <List
      data={["a", "b"]}
      keyExtractor={(row) => row}
      estimateSize={20}
      renderItem={(row) => <div>{row}</div>}
      className={cls}
      style={{ height: 40 }}
    />
  ),
  spinner: (cls) => <Spinner className={cls} />,
  "progress-bar": (cls) => <ProgressBar value={0.5} className={cls} />,
  skeleton: (cls) => <Skeleton className={cls} style={{ height: 8 }} />,
  divider: (cls) => <Divider className={cls} />,
  checkbox: (cls) => <Checkbox aria-label="checkbox" className={cls} />,
  "checkbox-box": (cls) => (
    <Checkbox aria-label="checkbox">
      <Checkbox.Box className={cls}>
        <Checkbox.Icon />
      </Checkbox.Box>
    </Checkbox>
  ),
  "checkbox-icon": (cls) => (
    <Checkbox aria-label="checkbox" defaultChecked>
      <Checkbox.Box>
        <Checkbox.Icon className={cls} />
      </Checkbox.Box>
    </Checkbox>
  ),
  "radio-item": (cls) => (
    <RadioGroup aria-label="radio" defaultValue="a">
      <RadioGroup.Item value="a" className={cls}>
        a
      </RadioGroup.Item>
    </RadioGroup>
  ),
  "radio-box": (cls) => (
    <RadioGroup aria-label="radio" defaultValue="a">
      <RadioGroup.Item value="a">
        <RadioGroup.Box className={cls}>
          <RadioGroup.Indicator />
        </RadioGroup.Box>
      </RadioGroup.Item>
    </RadioGroup>
  ),
  "radio-indicator": (cls) => (
    <RadioGroup aria-label="radio" defaultValue="a">
      <RadioGroup.Item value="a">
        <RadioGroup.Box>
          <RadioGroup.Indicator className={cls} />
        </RadioGroup.Box>
      </RadioGroup.Item>
    </RadioGroup>
  ),
  switch: (cls) => <Switch aria-label="switch" className={cls} />,
  "switch-thumb": (cls) => (
    <Switch aria-label="switch">
      <Switch.Thumb className={cls} />
    </Switch>
  ),
  slider: (cls) => (
    <Slider aria-label="slider" defaultValue={40} className={cls} />
  ),
  "slider-track": (cls) => (
    <Slider aria-label="slider" defaultValue={40}>
      <Slider.Track className={cls}>
        <Slider.Range />
      </Slider.Track>
      <Slider.Thumb />
    </Slider>
  ),
  "slider-range": (cls) => (
    <Slider aria-label="slider" defaultValue={40}>
      <Slider.Track>
        <Slider.Range className={cls} />
      </Slider.Track>
      <Slider.Thumb />
    </Slider>
  ),
  "slider-thumb": (cls) => (
    <Slider aria-label="slider" defaultValue={40}>
      <Slider.Track>
        <Slider.Range />
      </Slider.Track>
      <Slider.Thumb className={cls} />
    </Slider>
  ),
  input: (cls) => <Input aria-label="input" className={cls} />,
  "input-disabled": (cls) => (
    <Input aria-label="input" disabled className={cls} />
  ),
  "input-grouped": (cls) => (
    <Input aria-label="input" className={cls}>
      <Input.Leading>@</Input.Leading>
    </Input>
  ),
  "input-leading": (cls) => (
    <Input aria-label="input">
      <Input.Leading className={cls}>@</Input.Leading>
    </Input>
  ),
  "text-area": (cls) => (
    <TextArea aria-label="text area" className={cls} />
  ),
  "field-group-row": (cls) => (
    <FieldGroup>
      <FieldGroup.Section title="section">
        <FieldGroup.Row label="row" className={cls}>
          value
        </FieldGroup.Row>
      </FieldGroup.Section>
    </FieldGroup>
  ),
  "select-trigger": (cls) => (
    <Select aria-label="select" placeholder="pick">
      <Select.Trigger className={cls}>
        <Select.Value />
      </Select.Trigger>
      <Select.Content aria-label="options">
        <Select.Option value="a">a</Select.Option>
      </Select.Content>
    </Select>
  ),
  "select-content": (cls) => (
    <Select aria-label="select" placeholder="pick">
      <Select.Trigger>
        <Select.Value />
      </Select.Trigger>
      <Select.Content aria-label="options" className={cls}>
        <Select.Option value="a">a</Select.Option>
      </Select.Content>
    </Select>
  ),
  "dropdown-content": (cls) => (
    <Dropdown defaultOpen>
      <Dropdown.Trigger aria-label="menu">menu</Dropdown.Trigger>
      <Dropdown.Content aria-label="menu items" className={cls}>
        <Dropdown.Item onSelect={() => {}}>item</Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  ),
  "dropdown-item": (cls) => (
    <Dropdown defaultOpen>
      <Dropdown.Trigger aria-label="menu">menu</Dropdown.Trigger>
      <Dropdown.Content aria-label="menu items">
        <Dropdown.Item onSelect={() => {}} className={cls}>
          item
        </Dropdown.Item>
      </Dropdown.Content>
    </Dropdown>
  ),
  "drawer-content": (cls) => (
    <Drawer defaultOpen>
      <Drawer.Portal>
        <Drawer.Content className={cls}>sheet</Drawer.Content>
      </Drawer.Portal>
    </Drawer>
  ),
  "drawer-overlay": (cls) => (
    <Drawer defaultOpen>
      <Drawer.Portal>
        <Drawer.Overlay className={cls} />
        <Drawer.Content>sheet</Drawer.Content>
      </Drawer.Portal>
    </Drawer>
  ),
  "drawer-footer": (cls) => (
    <Drawer.Footer className={cls}>footer</Drawer.Footer>
  ),
  "drawer-shell": (cls) => (
    <Drawer.Shell className={cls}>shell</Drawer.Shell>
  ),
  "drawer-handle": (cls) => <Drawer.Handle className={cls} />,
  image: (cls) => (
    <Image
      src={labPhotoTallUrl}
      alt=""
      width={40}
      height={60}
      className={cls}
    />
  ),
  "pull-to-refresh": (cls) => (
    <PullToRefresh onRefresh={async () => {}} className={cls}>
      <div>rows</div>
    </PullToRefresh>
  ),
  "wheel-column": (cls) => (
    <WheelColumn
      items={WHEEL_ITEMS}
      value={1}
      onChange={() => {}}
      ariaLabel="wheel"
      className={cls}
    />
  ),
  "wheel-column-item": (cls) => (
    <WheelColumn
      items={WHEEL_ITEMS}
      value={1}
      onChange={() => {}}
      ariaLabel="wheel"
      itemClassName={cls}
    />
  ),
  splash: (cls) => <PwaSplashOverlay className={cls} />,
  offline: (cls) => <Offline onRetry={() => {}} className={cls} />,
  "not-found": (cls) => <UiNotFound className={cls} />,
}

//View's safe padding is the lock under test; a real inset makes it distinguishable from 0
const CASE_STYLE: Partial<Record<string, CSSProperties>> = {
  view: { "--adaptv-inset-bottom": "13px" } as CSSProperties,
}

function CaseRow({ c, dialect }: { c: PrecedenceCase; dialect: Dialect }) {
  const cls = classesFor(c, dialect) || undefined
  return (
    <div
      data-testid={`sp-${c.id}-${dialect}`}
      style={CASE_STYLE[c.id]}
      className="relative"
    >
      {RENDER[c.id]?.(cls)}
    </div>
  )
}

function LabStylePrecedencePage() {
  const only = useLocation({
    select: (location) => {
      const params = new URLSearchParams(location.searchStr)
      const id = params.get("only")
      const dialect = params.get("dialect") as Dialect | null
      return id && dialect ? { id, dialect } : null
    },
  })

  if (only) {
    const c = CASES.find((row) => row.id === only.id)
    return c ? <CaseRow c={c} dialect={only.dialect} /> : null
  }

  return (
    <LabPage
      title="Style precedence"
      subtitle="Every primitive, three times: bare, with a plain-CSS class, with a Tailwind utility. The class must beat adaptv's default; it must not move a lock."
    >
      <LabBrief
        what="That a consumer's className beats every adaptv default in both dialects, and that the properties adaptv locks (inline style) hold against both."
        steps={[
          "This page is a measurement surface for e2e/style-precedence.spec.ts. By eye: in each row, the plain and Tailwind copies look alike, and both differ from the bare copy where the row overrides a colour.",
        ]}
        expected={{
          web: {
            verdict: "works",
            note: "Cascade layers and inline style.",
          },
          pwa: { verdict: "works", note: "Same stylesheet." },
          ios: { verdict: "works", note: "Same stylesheet." },
          android: { verdict: "works", note: "Same stylesheet." },
        }}
        wrong="A Tailwind copy that still shows the default: adaptv's rule escaped its layer. A plain copy that moved a lock: the lock is not inline."
      />
      {CASES.filter((c) => !c.isolate).map((c) => (
        <LabSection key={c.id} title={c.id}>
          {DIALECTS.map((dialect) => (
            <CaseRow key={dialect} c={c} dialect={dialect} />
          ))}
        </LabSection>
      ))}
    </LabPage>
  )
}
