import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import type { Goal } from '../goals/types'
import { goalSlugsFor } from './goalHint'
import type { AnalyticsRuntime } from './runtime'

const goal = (slug: string): Goal => ({ slug, name: slug, match: { kind: 'goal' } })

const reqWith = (warn: (message: string) => void = () => {}): PayloadRequest =>
	({ payload: { logger: { warn } } }) as unknown as PayloadRequest

const runtimeWith = (partial: Partial<AnalyticsRuntime>): AnalyticsRuntime =>
	partial as AnalyticsRuntime

describe('goalSlugsFor', () => {
	it('hints a goal read with the scope slugs', async () => {
		const runtime = runtimeWith({ resolveGoals: async () => [goal('signup'), goal('purchase')] })
		expect(
			await goalSlugsFor({ runtime, req: reqWith(), scope: 'tenant-a', metrics: ['conversions'] })
		).toEqual(['signup', 'purchase'])
	})

	it('hints an empty list when the scope configures no goals', async () => {
		const runtime = runtimeWith({ resolveGoals: async () => [] })
		expect(
			await goalSlugsFor({
				runtime,
				req: reqWith(),
				scope: null,
				metrics: ['visitors'],
				dimensions: ['goal'],
			})
		).toEqual([])
	})

	it('hints unresolved and logs when the resolver throws', async () => {
		const warn = vi.fn()
		const runtime = runtimeWith({
			resolveGoals: () => Promise.reject(new Error('collection is down')),
		})
		expect(
			await goalSlugsFor({ runtime, req: reqWith(warn), scope: null, metrics: ['conversions'] })
		).toBe('unresolved')
		expect(warn).toHaveBeenCalledOnce()
	})

	it('leaves a read that is about no goal unhinted', async () => {
		const runtime = runtimeWith({ resolveGoals: async () => [goal('signup')] })
		expect(
			await goalSlugsFor({
				runtime,
				req: reqWith(),
				scope: null,
				metrics: ['pageviews'],
				dimensions: ['page'],
			})
		).toBeUndefined()
	})
})
