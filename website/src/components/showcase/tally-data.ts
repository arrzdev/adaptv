/*
 * Tally, the budget app in the hero (doc `landing-v2` §2.4). The only source of numbers for
 * both views: the desktop window and the phone show the same month.
 */

export const MONTH = "October"

export const BUDGET = 2000
export const SPENT = 1284
export const INCOME = 3150
export const LEFT = BUDGET - SPENT

export type Budget = { name: string; spent: number; limit: number }

export const BUDGETS: Budget[] = [
  { name: "Groceries", spent: 312, limit: 400 },
  { name: "Eating out", spent: 156, limit: 300 },
  { name: "Transport", spent: 62, limit: 200 },
  { name: "Subscriptions", spent: 48, limit: 60 },
]

export type Transaction = {
  merchant: string
  category: string
  date: string
  /** In cents; income is positive. */
  amount: number
}

export const TRANSACTIONS: Transaction[] = [
  {
    merchant: "Whole Foods",
    category: "Groceries",
    date: "Oct 11",
    amount: -4218,
  },
  { merchant: "Uber", category: "Transport", date: "Oct 10", amount: -890 },
  { merchant: "Salary", category: "Income", date: "Oct 10", amount: 315000 },
  {
    merchant: "Netflix",
    category: "Subscriptions",
    date: "Oct 9",
    amount: -1299,
  },
  {
    merchant: "Blue Bottle",
    category: "Eating out",
    date: "Oct 9",
    amount: -460,
  },
]

/** Oct 1–14. Days after TODAY are still to come and drawn as outlines. */
export const DAILY = [48, 12, 96, 30, 64, 22, 140, 38, 17, 51, 42, 0, 0, 0]
export const TODAY = 11

const whole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})
const cents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
})

/** $1,284 */
export const usd = (dollars: number) => whole.format(dollars)

/** −$42.18 or +$3,150.00, with a real minus sign. */
export const signed = (amount: number) =>
  `${amount < 0 ? "−" : "+"}${cents.format(Math.abs(amount) / 100)}`

/** 64, for a bar's width in %. */
export const percent = (part: number, total: number) =>
  Math.round((part / total) * 100)
