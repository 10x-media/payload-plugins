import { PURCHASE_GOAL_SLUG } from './constants'
import type { Goal } from './types'

/** Read where no request language is in hand; every surface that shows it translates it. */
const BUILTIN_PURCHASE_NAME = 'Purchase'

/**
 * The goal a sale completes when the install defines no `purchase` of its own; without it a sale's
 * amount would never reach `conversions` or `revenue`. No fixed value: the order's total is its worth.
 */
export const builtinPurchaseGoal = (): Goal => ({
	slug: PURCHASE_GOAL_SLUG,
	name: BUILTIN_PURCHASE_NAME,
	match: { kind: 'goal' },
})
