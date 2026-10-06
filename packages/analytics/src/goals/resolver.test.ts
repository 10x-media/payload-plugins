import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import {
	configGoalsResolver,
	createGoalsResolver,
	docToGoal,
	GOALS_CACHE_TTL_MS,
	mergeGoals,
} from './resolver'
import type { Goal } from './types'

const configGoals: Goal[] = [
	{ slug: 'demo', name: 'Book a demo', match: { kind: 'goal' }, value: { fixed: 10 } },
	{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
]

type FindArgs = { collection: string; where: Record<string, unknown> }

const warn = vi.fn()

/** A request double whose payload.find answers with the given documents (or throws). */
const reqWith = (find: (args: FindArgs) => unknown): PayloadRequest =>
	({ payload: { find, logger: { warn } } }) as unknown as PayloadRequest

const docs = (rows: Array<Record<string, unknown>>) => async () => ({ docs: rows })

describe('docToGoal', () => {
	it('maps an enabled document with every optional field', () => {
		expect(
			docToGoal({
				slug: 'purchase',
				name: 'Purchase',
				enabled: true,
				match: { kind: 'event', name: 'checkout_complete' },
				value: { fixed: 25, prop: 'amount' },
				currency: 'EUR',
			})
		).toEqual({
			slug: 'purchase',
			name: 'Purchase',
			match: { kind: 'event', name: 'checkout_complete' },
			value: { fixed: 25, prop: 'amount' },
			currency: 'EUR',
		})
	})

	it('falls back to the slug when the document has no name', () => {
		expect(docToGoal({ slug: 'demo', match: { kind: 'goal' } })?.name).toBe('demo')
	})

	it('drops empty optional fields rather than carrying nulls through', () => {
		expect(
			docToGoal({ slug: 'demo', match: { kind: 'goal' }, value: { fixed: null }, currency: null })
		).toEqual({ slug: 'demo', name: 'demo', match: { kind: 'goal' } })
	})

	it('skips a disabled document', () => {
		expect(docToGoal({ slug: 'demo', enabled: false, match: { kind: 'goal' } })).toBeNull()
	})

	it.each([
		['a slug that is not kebab-case', { slug: 'Book Demo', match: { kind: 'goal' } }],
		['no slug at all', { match: { kind: 'goal' } }],
		['an unknown match kind', { slug: 'demo', match: { kind: 'session' } }],
		['no match at all', { slug: 'demo' }],
		['an event match with no name', { slug: 'demo', match: { kind: 'event' } }],
		['a path match with no pattern', { slug: 'demo', match: { kind: 'path' } }],
		['a negative fixed value', { slug: 'demo', match: { kind: 'goal' }, value: { fixed: -1 } }],
		[
			'a non-finite fixed value',
			{ slug: 'demo', match: { kind: 'goal' }, value: { fixed: Number.NaN } },
		],
	])('skips a document with %s', (_label, doc) => {
		expect(docToGoal(doc)).toBeNull()
	})
})

describe('mergeGoals', () => {
	it('keeps config order and appends collection extras', () => {
		const extra: Goal = { slug: 'signup', name: 'Signup', match: { kind: 'goal' } }
		expect(mergeGoals(configGoals, [extra]).map((g) => g.slug)).toEqual([
			'demo',
			'thanks',
			'signup',
		])
	})

	it('lets a collection goal win over a config goal with the same slug', () => {
		const override: Goal = {
			slug: 'demo',
			name: 'Demo (edited)',
			match: { kind: 'goal' },
			value: { fixed: 99 },
		}
		const merged = mergeGoals(configGoals, [override])
		expect(merged).toHaveLength(2)
		expect(merged[0]).toBe(override)
	})

	it('keeps the first of two collection goals sharing a slug', () => {
		const first: Goal = { slug: 'x', name: 'first', match: { kind: 'goal' } }
		const second: Goal = { slug: 'x', name: 'second', match: { kind: 'goal' } }
		expect(mergeGoals([], [first, second])).toEqual([first])
	})
})

describe('configGoalsResolver', () => {
	it('serves the config goals without ever reading a collection', async () => {
		const resolver = configGoalsResolver(configGoals)
		const req = reqWith(() => {
			throw new Error('must not read')
		})
		expect(await resolver.resolve(req)).toEqual(configGoals)
		expect((await resolver.resolveDetailed(req)).map((r) => r.source)).toEqual(['config', 'config'])
		resolver.invalidate()
	})
})

describe('createGoalsResolver', () => {
	const base = { slug: 'analytics-goals', scopeField: 'scope', config: configGoals }

	it('merges collection goals over config goals', async () => {
		const resolver = createGoalsResolver({ ...base, scoped: false })
		const goals = await resolver.resolve(
			reqWith(docs([{ slug: 'demo', name: 'Edited', match: { kind: 'goal' }, enabled: true }]))
		)
		expect(goals.map((g) => g.name)).toEqual(['Edited', 'Thanks'])
	})

	it('reports where each resolved goal came from', async () => {
		const resolver = createGoalsResolver({ ...base, scoped: false })
		const resolved = await resolver.resolveDetailed(
			reqWith(
				docs([
					{ slug: 'demo', name: 'Edited', match: { kind: 'goal' } },
					{ slug: 'signup', name: 'Signup', match: { kind: 'goal' } },
				])
			)
		)
		expect(resolved.map((r) => [r.goal.slug, r.source])).toEqual([
			['demo', 'collection'],
			['thanks', 'config'],
			['signup', 'collection'],
		])
	})

	it('skips disabled and malformed documents', async () => {
		const resolver = createGoalsResolver({ ...base, scoped: false, config: [] })
		const goals = await resolver.resolve(
			reqWith(
				docs([
					{ slug: 'off', match: { kind: 'goal' }, enabled: false },
					{ slug: 'Bad Slug', match: { kind: 'goal' } },
					{ slug: 'good', match: { kind: 'goal' } },
				])
			)
		)
		expect(goals.map((g) => g.slug)).toEqual(['good'])
	})

	it('caches per scope for the TTL and refetches after it', async () => {
		let now = 0
		const find = vi.fn(docs([{ slug: 'demo', name: 'Edited', match: { kind: 'goal' } }]))
		const resolver = createGoalsResolver({ ...base, scoped: true, now: () => now })
		const req = reqWith(find)
		await resolver.resolve(req, 'tenant-a')
		await resolver.resolve(req, 'tenant-a')
		expect(find).toHaveBeenCalledTimes(1)
		await resolver.resolve(req, 'tenant-b')
		expect(find).toHaveBeenCalledTimes(2)
		now += GOALS_CACHE_TTL_MS + 1
		await resolver.resolve(req, 'tenant-a')
		expect(find).toHaveBeenCalledTimes(3)
	})

	it('treats a null scope and an empty scope as one cache entry', async () => {
		const find = vi.fn(docs([]))
		const resolver = createGoalsResolver({ ...base, scoped: true })
		await resolver.resolve(reqWith(find), null)
		await resolver.resolve(reqWith(find), '')
		expect(find).toHaveBeenCalledTimes(1)
	})

	it('invalidate forces a refetch', async () => {
		const find = vi.fn(docs([]))
		const resolver = createGoalsResolver({ ...base, scoped: false })
		await resolver.resolve(reqWith(find))
		resolver.invalidate()
		await resolver.resolve(reqWith(find))
		expect(find).toHaveBeenCalledTimes(2)
	})

	it('constrains the query to the scope in scoped installs', async () => {
		const calls: FindArgs[] = []
		const resolver = createGoalsResolver({ ...base, scoped: true })
		const req = reqWith((args) => {
			calls.push(args)
			return { docs: [] }
		})
		await resolver.resolve(req, 'tenant-a')
		expect(calls[0]?.collection).toBe('analytics-goals')
		expect(JSON.stringify(calls[0]?.where)).toContain('tenant-a')
	})

	it('omits the scope clause in unscoped installs', async () => {
		const calls: FindArgs[] = []
		const resolver = createGoalsResolver({ ...base, scoped: false })
		await resolver.resolve(
			reqWith((args) => {
				calls.push(args)
				return { docs: [] }
			}),
			null
		)
		expect(JSON.stringify(calls[0]?.where)).not.toContain('scope')
	})

	it('falls back to config goals and warns once per scope per window when the read fails', async () => {
		warn.mockClear()
		let now = 0
		const find = vi.fn(() => {
			throw new Error('db down')
		})
		const resolver = createGoalsResolver({ ...base, scoped: false, now: () => now })
		const req = reqWith(find)
		expect((await resolver.resolve(req)).map((g) => g.slug)).toEqual(['demo', 'thanks'])
		await resolver.resolve(req)
		expect(warn).toHaveBeenCalledTimes(1)
		now += GOALS_CACHE_TTL_MS + 1
		await resolver.resolve(req)
		expect(warn).toHaveBeenCalledTimes(2)
	})
})
