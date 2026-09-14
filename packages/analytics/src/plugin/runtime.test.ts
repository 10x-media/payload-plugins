import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import type { Goal } from '../goals/types'
import type { AnalyticsRuntime } from './runtime'
import { platformReadGate, resolveGoalsDetailedFor, resolveGoalsFor } from './runtime'

const goal: Goal = { slug: 'demo', name: 'Demo', match: { kind: 'goal' } }
const req = {} as PayloadRequest

const runtimeWith = (partial: Partial<AnalyticsRuntime>): AnalyticsRuntime =>
	partial as AnalyticsRuntime

describe('resolveGoalsFor', () => {
	it('asks the resolver when the runtime carries one', async () => {
		const merged: Goal[] = [goal, { ...goal, slug: 'from-collection' }]
		const runtime = runtimeWith({ goals: [goal], resolveGoals: async () => merged })
		expect(await resolveGoalsFor(runtime, req, 'tenant-a')).toBe(merged)
	})

	it('falls back to the config goals, then to none', async () => {
		expect(await resolveGoalsFor(runtimeWith({ goals: [goal] }), req)).toEqual([goal])
		expect(await resolveGoalsFor(runtimeWith({}), req)).toEqual([])
	})
})

describe('resolveGoalsDetailedFor', () => {
	it('tags the fallback goals as config-sourced', async () => {
		expect(await resolveGoalsDetailedFor(runtimeWith({ goals: [goal] }), req)).toEqual([
			{ goal, source: 'config' },
		])
	})

	it('asks the resolver when the runtime carries one', async () => {
		const detailed = [{ goal, source: 'collection' as const }]
		const runtime = runtimeWith({ goals: [], resolveGoalsDetailed: async () => detailed })
		expect(await resolveGoalsDetailedFor(runtime, req)).toBe(detailed)
	})
})

describe('platformReadGate', () => {
	it('evaluates the access check once however many gates consult it', async () => {
		let calls = 0
		const runtime = runtimeWith({
			platformRead: () => {
				calls += 1
				return true
			},
		})
		const gate = platformReadGate(runtime, req)
		expect(await Promise.all([gate(), gate(), gate()])).toEqual([true, true, true])
		expect(calls).toBe(1)
	})
})
