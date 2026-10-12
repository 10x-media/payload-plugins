import { describe, expect, it } from 'vitest'
import { PURCHASE_GOAL_SLUG } from './constants'
import { hasNoDeclaredGoals, isLatentGoalRow } from './latent'

describe('hasNoDeclaredGoals', () => {
	it('reads a hint carrying only the built-in goal as an install with no goals', () => {
		expect(hasNoDeclaredGoals([PURCHASE_GOAL_SLUG], [PURCHASE_GOAL_SLUG])).toBe(true)
		expect(hasNoDeclaredGoals([], [])).toBe(true)
	})

	it('reads a declared goal beside it as goals', () => {
		expect(hasNoDeclaredGoals(['signup', PURCHASE_GOAL_SLUG], [PURCHASE_GOAL_SLUG])).toBe(false)
	})

	// An install that declares `purchase` itself owns the slug, so nothing is latent.
	it('treats every slug as declared when nothing is built in', () => {
		expect(hasNoDeclaredGoals([PURCHASE_GOAL_SLUG], [])).toBe(false)
		expect(hasNoDeclaredGoals([PURCHASE_GOAL_SLUG], undefined)).toBe(false)
	})
})

describe('isLatentGoalRow', () => {
	it('drops a built-in row nobody has converted on', () => {
		expect(isLatentGoalRow(PURCHASE_GOAL_SLUG, 0, [PURCHASE_GOAL_SLUG])).toBe(true)
		expect(isLatentGoalRow(PURCHASE_GOAL_SLUG, undefined, [PURCHASE_GOAL_SLUG])).toBe(true)
	})

	it('keeps it once it has conversions, which is what makes it latent rather than hidden', () => {
		expect(isLatentGoalRow(PURCHASE_GOAL_SLUG, 3, [PURCHASE_GOAL_SLUG])).toBe(false)
	})

	it('never drops a declared goal, however empty its row', () => {
		expect(isLatentGoalRow('signup', 0, [PURCHASE_GOAL_SLUG])).toBe(false)
	})
})
