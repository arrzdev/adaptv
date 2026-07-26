import {
  createdGroupLabel,
  dayKey,
  diffInDays,
  dueDateLabel,
  startOfDay,
  updatedGroupLabel,
} from "@/data/collections/todos/dates"
import {
  priorityLabel,
  priorityRank,
} from "@/data/collections/todos/priority"
import type { Todo } from "@/data/collections/todos/schema"

export const TODO_SORT_VALUES = [
  "created",
  "updated",
  "due",
  "priority",
  "custom",
] as const

export type TodoSort = (typeof TODO_SORT_VALUES)[number]

export type TodoSection = {
  key: string
  title: string
  todos: Todo[]
}

function byCreatedDesc(a: Todo, b: Todo): number {
  return b.createdAt.getTime() - a.createdAt.getTime()
}

function byUpdatedDesc(a: Todo, b: Todo): number {
  return b.updatedAt.getTime() - a.updatedAt.getTime()
}

//absent due date always sorts after dated todos
function byDueAsc(a: Todo, b: Todo): number {
  const at = a.dueAt ? a.dueAt.getTime() : Number.POSITIVE_INFINITY
  const bt = b.dueAt ? b.dueAt.getTime() : Number.POSITIVE_INFINITY
  return at - bt
}

//checkedAt/archivedAt can be absent on legacy todos — fall back to updatedAt so
//the order stays stable rather than collapsing the undated ones together
function byCheckedAtDesc(a: Todo, b: Todo): number {
  const at = (a.checkedAt ?? a.updatedAt).getTime()
  const bt = (b.checkedAt ?? b.updatedAt).getTime()
  return bt - at
}

function byArchivedAtDesc(a: Todo, b: Todo): number {
  const at = (a.archivedAt ?? a.updatedAt).getTime()
  const bt = (b.archivedAt ?? b.updatedAt).getTime()
  return bt - at
}

//---- active-view completed block: newest-checked first, pinned to the bottom ----

export function sortCompleted(todos: Todo[]): Todo[] {
  return [...todos].sort(byCheckedAtDesc)
}

//---- archive: a single flat list, most-recently-archived first ----

export function sortArchived(todos: Todo[]): Todo[] {
  return [...todos].sort(byArchivedAtDesc)
}

//---- created: one section per day, newest first; literal within ----

function groupByCreated(todos: Todo[], now: Date): TodoSection[] {
  const sorted = [...todos].sort(byCreatedDesc)
  const sections: TodoSection[] = []
  const index = new Map<string, TodoSection>()

  for (const todo of sorted) {
    const key = dayKey(todo.createdAt)
    let section = index.get(key)
    if (!section) {
      section = {
        key,
        title: createdGroupLabel(todo.createdAt, now),
        todos: [],
      }
      index.set(key, section)
      sections.push(section)
    }
    section.todos.push(todo)
  }

  return sections
}

//---- updated: one section per day, most recently updated first ----

function groupByUpdated(todos: Todo[], now: Date): TodoSection[] {
  const sorted = [...todos].sort(byUpdatedDesc)
  const sections: TodoSection[] = []
  const index = new Map<string, TodoSection>()

  for (const todo of sorted) {
    const key = dayKey(todo.updatedAt)
    let section = index.get(key)
    if (!section) {
      section = {
        key,
        title: updatedGroupLabel(todo.updatedAt, now),
        todos: [],
      }
      index.set(key, section)
      sections.push(section)
    }
    section.todos.push(todo)
  }

  return sections
}

//---- due: Overdue -> dated ascending -> No due date; priority desc within ----

function groupByDue(todos: Todo[], now: Date): TodoSection[] {
  const overdue: Todo[] = []
  const undated: Todo[] = []
  const dated = new Map<string, { time: number; section: TodoSection }>()

  for (const todo of todos) {
    const due = todo.dueAt
    if (!due) {
      undated.push(todo)
      continue
    }
    if (diffInDays(due, now) < 0) {
      overdue.push(todo)
      continue
    }

    const key = dayKey(due)
    let entry = dated.get(key)
    if (!entry) {
      entry = {
        time: startOfDay(due).getTime(),
        section: { key, title: dueDateLabel(due, now), todos: [] },
      }
      dated.set(key, entry)
    }
    entry.section.todos.push(todo)
  }

  const sections: TodoSection[] = []
  if (overdue.length > 0) {
    sections.push({ key: "overdue", title: "Overdue", todos: overdue })
  }
  for (const entry of [...dated.values()].sort(
    (a, b) => a.time - b.time,
  )) {
    sections.push(entry.section)
  }
  if (undated.length > 0) {
    sections.push({ key: "no-due", title: "No due date", todos: undated })
  }

  for (const section of sections) {
    section.todos.sort(
      (a, b) =>
        priorityRank(b.priority) - priorityRank(a.priority) ||
        byCreatedDesc(a, b),
    )
  }

  return sections
}

//---- priority: highest level first, None last; due ascending within ----

function groupByPriority(todos: Todo[]): TodoSection[] {
  const index = new Map<number, TodoSection>()

  for (const todo of todos) {
    const rank = priorityRank(todo.priority)
    let section = index.get(rank)
    if (!section) {
      section = {
        key: todo.priority ? `p${todo.priority}` : "p0",
        title: priorityLabel(todo.priority),
        todos: [],
      }
      index.set(rank, section)
    }
    section.todos.push(todo)
  }

  const sections = [...index.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, section]) => section)

  for (const section of sections) {
    section.todos.sort((a, b) => byDueAsc(a, b) || byCreatedDesc(a, b))
  }

  return sections
}

//---- custom: a single flat list in the user's drag-to-reorder order ----

function groupCustom(todos: Todo[]): TodoSection[] {
  if (todos.length === 0) return []
  const sorted = [...todos].sort(
    (a, b) => a.position - b.position || byCreatedDesc(a, b),
  )
  return [{ key: "all", title: "Custom", todos: sorted }]
}

export function groupTodos(
  todos: Todo[],
  sort: TodoSort,
  now: Date = new Date(),
): TodoSection[] {
  if (sort === "updated") return groupByUpdated(todos, now)
  if (sort === "due") return groupByDue(todos, now)
  if (sort === "priority") return groupByPriority(todos)
  if (sort === "custom") return groupCustom(todos)
  return groupByCreated(todos, now)
}
