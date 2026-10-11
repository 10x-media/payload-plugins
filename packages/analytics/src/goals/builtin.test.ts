import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { toHit } from '../native/engine/toHit'
import type { NormalizedEvent } from '../native/ingest/normalizeEvent'
import { builtinPurchaseGoal } from './builtin'
import { PURCHASE_GOAL_SLUG } from './constants'
import { completionAmounts, type GoalCompletion, type MatchableEvent } from './match'
import { configGoalsResolver } from './resolver'
import type { Goal } from './types'

const req = {} as PayloadRequest

const sale = { type: 'goal', name: PURCHASE_GOAL_SLUG, path: '/orders', value: 49 }

/** Completions as a server call books them: its own value, a refund's negative included. */
const serverCompletions = (event: MatchableEvent, goals: Goal[]): GoalCompletion[] =>
	completionAmounts(event, goals, { allowNegativeValue: true }).map(({ goal, amount }) => ({
		slug: goal.slug,
		value: amount,
	}))

const AT = new Date('2026-01-10T13:45:00Z')

const normalized = (over: Partial<NormalizedEvent>): NormalizedEvent => ({
	timestamp: AT,
	type: 'goal',
	name: PURCHASE_GOAL_SLUG,
	path: '/orders',
	hostname: '',
	visitorId: '',
	server: true,
	value: 49,
	...over,
})

describe('builtinPurchaseGoal', () => {
	it('matches a purchase call and carries no value of its own', () => {
		expect(builtinPurchaseGoal()).toEqual({
			slug: PURCHASE_GOAL_SLUG,
			name: 'Purchase',
			match: { kind: 'goal' },
		})
	})
})

describe('revenue with no user-defined goals', () => {
	it('stores the sale as a completion of the built-in goal, its money counted', async () => {
		const goals = await configGoalsResolver([]).resolve(req)
		const completions = serverCompletions(sale, goals)
		expect(completions).toEqual([{ slug: PURCHASE_GOAL_SLUG, value: 49 }])

		const hit = toHit(normalized({ goals: completions }), { receivedAt: AT })
		expect(hit).toMatchObject({
			conversions: 1,
			revenue: 49,
			goals: [{ slug: PURCHASE_GOAL_SLUG, value: 49 }],
		})
	})

	it('counts nothing once the install opts out with goals.purchase: false', async () => {
		// The sale is still stored; it just completes nothing.
		const goals = await configGoalsResolver([], false).resolve(req)
		expect(serverCompletions(sale, goals)).toEqual([])

		const hit = toHit(normalized({}), { receivedAt: AT })
		expect(hit).toMatchObject({ type: 'goal', value: 49 })
		expect(hit).not.toHaveProperty('conversions')
		expect(hit).not.toHaveProperty('revenue')
		expect(hit).not.toHaveProperty('goals')
	})

	it('books a refund against the built-in goal as its own negative completion', async () => {
		const goals = await configGoalsResolver([]).resolve(req)
		expect(serverCompletions({ ...sale, value: -49 }, goals)).toEqual([
			{ slug: PURCHASE_GOAL_SLUG, value: -49 },
		])
	})
})
