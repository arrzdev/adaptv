export const TODO_FILTER_VALUES = ["active", "archived"] as const

export type TodoFilter = (typeof TODO_FILTER_VALUES)[number]
