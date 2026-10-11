import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { type CollectionProbe, PROBE_MEMO_MS } from '../providers/probe'
import { SCOPE_STATE_CAPACITY } from '../surfacing/bounded'
import { FIXED_CONFIG_EPOCH } from '../surfacing/epoch'
import { builtinPurchaseGoal } from './builtin'
import {
	type CreateGoalsResolverArgs,
	configGoalsResolver,
	createGoalsResolver,
	docToGoal,
	mergeGoals,
} from './resolver'
import type { Goal } from './types'

const configGoals: Goal[] = [
	{ slug: 'demo', name: 'Book a demo', match: { kind: 'goal' }, value: { fixed: 10 } },
	{ slug: 'thanks', name: 'Thanks', match: { kind: 'path', pattern: '/thank-you' } },
]

type FindArgs = {
	collection: string
	where: Record<string, unknown>
	overrideAccess?: boolean
	user?: unknown
}

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

	it('carries a server-only goal as browser: false, and nothing for one the browser may complete', () => {
		const goal = { slug: 'subscription', match: { kind: 'goal' } }
		expect(docToGoal({ ...goal, browser: false })?.browser).toBe(false)
		expect(docToGoal({ ...goal, browser: true })).not.toHaveProperty('browser')
		expect(docToGoal(goal)).not.toHaveProperty('browser')
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
	const merged = (config: Goal[], collection: Goal[], purchase?: boolean): Goal[] =>
		mergeGoals(config, collection, purchase).map((entry) => entry.goal)

	it('keeps config order and appends collection extras', () => {
		const extra: Goal = { slug: 'signup', name: 'Signup', match: { kind: 'goal' } }
		expect(merged(configGoals, [extra], false).map((g) => g.slug)).toEqual([
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
		const goals = merged(configGoals, [override], false)
		expect(goals).toHaveLength(2)
		expect(goals[0]).toBe(override)
	})

	it('keeps the first of two collection goals sharing a slug', () => {
		const first: Goal = { slug: 'x', name: 'first', match: { kind: 'goal' } }
		const second: Goal = { slug: 'x', name: 'second', match: { kind: 'goal' } }
		expect(merged([], [first, second], false)).toEqual([first])
	})

	it('adds the built-in purchase goal last, so revenue counts with nothing configured', () => {
		expect(merged([], [])).toEqual([builtinPurchaseGoal()])
		expect(merged(configGoals, []).map((g) => g.slug)).toEqual(['demo', 'thanks', 'purchase'])
	})

	it('lets a config or a collection goal claim the purchase slug instead', () => {
		const own: Goal = { slug: 'purchase', name: 'Order', match: { kind: 'event', name: 'sale' } }
		expect(merged([own], [])).toEqual([own])
		expect(merged([], [own])).toEqual([own])
	})

	it('drops the built-in goal when the install said purchase: false', () => {
		expect(merged([], [], false)).toEqual([])
	})
})

describe('configGoalsResolver', () => {
	it('serves the config goals and the built-in one without ever reading a collection', async () => {
		const resolver = configGoalsResolver(configGoals)
		const req = reqWith(() => {
			throw new Error('must not read')
		})
		expect(await resolver.resolve(req)).toEqual([...configGoals, builtinPurchaseGoal()])
		expect((await resolver.resolveDetailed(req)).map((r) => r.source)).toEqual([
			'config',
			'config',
			'builtin',
		])
		resolver.changed(['tenant-a'])
	})

	it('serves the built-in goal name in the caller admin language', async () => {
		const resolver = configGoalsResolver([])
		const req = reqWith(() => {
			throw new Error('must not read')
		})
		req.i18n = { t: () => 'Kauf' } as unknown as PayloadRequest['i18n']
		expect((await resolver.resolve(req)).map((g) => g.name)).toEqual(['Kauf'])
		// The cached entry is untouched, so the next language gets its own answer.
		const other = reqWith(() => {
			throw new Error('must not read')
		})
		expect((await resolver.resolve(other)).map((g) => g.name)).toEqual(['Purchase'])
	})

	it('serves nothing at all when the install said purchase: false', async () => {
		const resolver = configGoalsResolver([], false)
		const req = reqWith(() => {
			throw new Error('must not read')
		})
		expect(await resolver.resolve(req)).toEqual([])
	})
})

describe('createGoalsResolver', () => {
	const base = {
		slug: 'analytics-goals',
		scopeField: 'scope',
		config: configGoals,
		purchase: false,
	}

	/** A probe double: one epoch per scope, moved by hand, and the scopes a save expedited. */
	const probeWith = (epochs = new Map<string, string>()) => {
		const expedited: Array<string | null> = []
		const probe: CollectionProbe = {
			read: async (scope) => ({ rows: [], epoch: epochs.get(scope ?? '') ?? 'e0' }),
			expedite: (scopes) => {
				expedited.push(...scopes)
			},
		}
		return { probe, epochs, expedited }
	}

	/** The instance the resolver reads through: its goals collection answers with `find`. */
	const instanceWith = (find: (args: FindArgs) => unknown): Payload =>
		({ find, logger: { warn }, collections: { 'analytics-goals': {} } }) as unknown as Payload

	const req = {} as PayloadRequest

	const resolverOver = (
		find: (args: FindArgs) => unknown,
		over: Partial<CreateGoalsResolverArgs> = {}
	) => {
		const probed = probeWith()
		const resolver = createGoalsResolver({
			...base,
			scoped: false,
			payload: instanceWith(find),
			probe: probed.probe,
			...over,
		})
		return { resolver, ...probed }
	}

	it('merges collection goals over config goals', async () => {
		const { resolver } = resolverOver(
			docs([{ slug: 'demo', name: 'Edited', match: { kind: 'goal' }, enabled: true }])
		)
		expect((await resolver.resolve(req)).map((g) => g.name)).toEqual(['Edited', 'Thanks'])
	})

	it('reports where each resolved goal came from', async () => {
		const { resolver } = resolverOver(
			docs([
				{ slug: 'demo', name: 'Edited', match: { kind: 'goal' } },
				{ slug: 'signup', name: 'Signup', match: { kind: 'goal' } },
			])
		)
		expect((await resolver.resolveDetailed(req)).map((r) => [r.goal.slug, r.source])).toEqual([
			['demo', 'collection'],
			['thanks', 'config'],
			['signup', 'collection'],
		])
	})

	it('adds the built-in goal behind the collection, unless a document claims its slug', async () => {
		const builtin = resolverOver(docs([]), { config: [], purchase: true }).resolver
		expect((await builtin.resolveDetailed(req)).map((r) => [r.goal.slug, r.source])).toEqual([
			['purchase', 'builtin'],
		])
		const claimed = resolverOver(
			docs([{ slug: 'purchase', name: 'Order', match: { kind: 'goal' } }]),
			{ config: [], purchase: true }
		).resolver
		expect((await claimed.resolveDetailed(req)).map((r) => [r.goal.slug, r.source])).toEqual([
			['purchase', 'collection'],
		])
	})

	it('skips disabled and malformed documents', async () => {
		const { resolver } = resolverOver(
			docs([
				{ slug: 'off', match: { kind: 'goal' }, enabled: false },
				{ slug: 'Bad Slug', match: { kind: 'goal' } },
				{ slug: 'good', match: { kind: 'goal' } },
			]),
			{ config: [] }
		)
		expect((await resolver.resolve(req)).map((g) => g.slug)).toEqual(['good'])
	})

	it('reads a scope again only once its epoch moved, and each scope on its own', async () => {
		const find = vi.fn(docs([{ slug: 'demo', name: 'Edited', match: { kind: 'goal' } }]))
		const { resolver, epochs } = resolverOver(find, { scoped: true })
		await resolver.resolve(req, 'tenant-a')
		await resolver.resolve(req, 'tenant-a')
		expect(find).toHaveBeenCalledTimes(1)
		await resolver.resolve(req, 'tenant-b')
		expect(find).toHaveBeenCalledTimes(2)
		epochs.set('tenant-a', 'e1')
		await resolver.resolve(req, 'tenant-a')
		expect(find).toHaveBeenCalledTimes(3)
		await resolver.resolve(req, 'tenant-b')
		expect(find).toHaveBeenCalledTimes(3)
	})

	it('keeps goals for at most a bounded number of scopes, forgetting the least recent', async () => {
		const find = vi.fn(docs([]))
		const { resolver } = resolverOver(find, { scoped: true })
		await resolver.resolve(req, 'first')
		for (let index = 0; index < SCOPE_STATE_CAPACITY; index++) {
			await resolver.resolve(req, `scope-${index}`)
		}
		expect(find).toHaveBeenCalledTimes(SCOPE_STATE_CAPACITY + 1)
		await resolver.resolve(req, `scope-${SCOPE_STATE_CAPACITY - 1}`)
		expect(find).toHaveBeenCalledTimes(SCOPE_STATE_CAPACITY + 1)
		await resolver.resolve(req, 'first')
		expect(find).toHaveBeenCalledTimes(SCOPE_STATE_CAPACITY + 2)
	})

	it('treats a null scope and an empty scope as one cache entry', async () => {
		const find = vi.fn(docs([]))
		const { resolver } = resolverOver(find, { scoped: true })
		await resolver.resolve(req, null)
		await resolver.resolve(req, '')
		expect(find).toHaveBeenCalledTimes(1)
	})

	// Ingest and server tracking hand over a request that may hold the host's open transaction.
	it('reads the documents on a request of its own, with every goal the scope holds', async () => {
		const calls: Array<FindArgs & { req?: unknown }> = []
		const { resolver } = resolverOver((args) => {
			calls.push(args)
			return { docs: [] }
		})
		await resolver.resolve({ transactionID: 'host' } as unknown as PayloadRequest)
		expect(calls[0]?.req).toBeUndefined()
		expect(calls[0]?.overrideAccess).toBe(true)
	})

	it('constrains the query to the scope in scoped installs', async () => {
		const calls: FindArgs[] = []
		const { resolver } = resolverOver(
			(args) => {
				calls.push(args)
				return { docs: [] }
			},
			{ scoped: true }
		)
		await resolver.resolve(req, 'tenant-a')
		expect(calls[0]?.collection).toBe('analytics-goals')
		expect(JSON.stringify(calls[0]?.where)).toContain('tenant-a')
	})

	it('omits the scope clause in unscoped installs', async () => {
		const calls: FindArgs[] = []
		const { resolver } = resolverOver((args) => {
			calls.push(args)
			return { docs: [] }
		})
		await resolver.resolve(req, null)
		expect(JSON.stringify(calls[0]?.where)).not.toContain('scope')
	})

	it('keys on the probe’s epoch, and on a token of each outage’s own while the collection cannot be read', async () => {
		const { resolver, epochs } = resolverOver(docs([]), { scoped: true })
		epochs.set('tenant-a', 'e7')
		expect(await resolver.epoch('tenant-a')).toBe('e7')
		let down = true
		const failing = createGoalsResolver({
			...base,
			scoped: true,
			payload: instanceWith(docs([])),
			probe: {
				read: async () => {
					if (down) {
						throw new Error('db down')
					}
					return { rows: [], epoch: 'e1' }
				},
				expedite: () => {},
			},
		})
		const first = await failing.epoch('tenant-a')
		expect(first).toMatch(/^outage-/)
		expect(await failing.epoch('tenant-a')).toBe(first)
		expect(await failing.epoch('tenant-b')).not.toBe(first)
		down = false
		expect(await failing.epoch('tenant-a')).toBe('e1')
		down = true
		const second = await failing.epoch('tenant-a')
		expect(second).toMatch(/^outage-/)
		expect(second).not.toBe(first)
		expect(second).not.toBe('e1')
		expect(await configGoalsResolver(configGoals).epoch('tenant-a')).toBe(FIXED_CONFIG_EPOCH)
	})

	it('expedites the scopes a save touched, as the resolver reads them', async () => {
		const scoped = resolverOver(docs([]), { scoped: true })
		scoped.resolver.changed(['tenant-a', ''])
		expect(scoped.expedited).toEqual(['tenant-a', null])
		const unscoped = resolverOver(docs([]))
		unscoped.resolver.changed(['tenant-a'])
		expect(unscoped.expedited).toEqual([null])
	})

	it('falls back to config goals and warns once per scope per window when the read fails', async () => {
		warn.mockClear()
		let now = 0
		const find = vi.fn(() => {
			throw new Error('db down')
		})
		const { resolver } = resolverOver(find, { now: () => now })
		expect((await resolver.resolve(req)).map((g) => g.slug)).toEqual(['demo', 'thanks'])
		await resolver.resolve(req)
		expect(warn).toHaveBeenCalledTimes(1)
		expect(await resolver.epoch()).toMatch(/^outage-/)
		now += PROBE_MEMO_MS + 1
		await resolver.resolve(req)
		expect(warn).toHaveBeenCalledTimes(2)
	})
})

describe('listing goals for a reader', () => {
	const base = {
		slug: 'analytics-goals',
		scopeField: 'scope',
		config: configGoals,
		purchase: true,
	}

	/** The documents the collection's read access lets the asking user see, and every one besides. */
	const accessAware = (calls: FindArgs[]) => (args: FindArgs) => {
		calls.push(args)
		const all = [
			{ slug: 'newsletter', name: 'Newsletter', match: { kind: 'goal' } },
			{ slug: 'secret', name: 'Board only', match: { kind: 'goal' } },
		]
		return { docs: args.overrideAccess === false ? all.slice(0, 1) : all }
	}

	/** A resolver whose instance and request share one collection double. */
	const over = (find: (args: FindArgs) => unknown, scoped: boolean) => {
		const req = reqWith(find)
		Object.assign(req.payload, { collections: { 'analytics-goals': {} } })
		const resolver = createGoalsResolver({
			...base,
			scoped,
			payload: req.payload,
			probe: { read: async () => ({ rows: [], epoch: 'e0' }), expedite: () => {} },
		})
		return { req, resolver }
	}

	it("asks the collection's read access with the request's user, and lists config and built-in goals too", async () => {
		const calls: FindArgs[] = []
		const { req, resolver } = over(accessAware(calls), true)
		Object.assign(req, { user: { id: 7, collection: 'users' } })
		const listed = await resolver.listReadable(req, 'tenant-a')
		expect(listed.map((entry) => [entry.goal.slug, entry.source])).toEqual([
			['demo', 'config'],
			['thanks', 'config'],
			['newsletter', 'collection'],
			['purchase', 'builtin'],
		])
		expect(calls[0]).toMatchObject({ overrideAccess: false, user: { id: 7 } })
		expect(JSON.stringify(calls[0]?.where)).toContain('tenant-a')
	})

	it('leaves matching on every goal the scope holds, and caches nothing per reader', async () => {
		const calls: FindArgs[] = []
		const { req, resolver } = over(accessAware(calls), true)
		expect((await resolver.resolve(req, 'tenant-a')).map((goal) => goal.slug)).toContain('secret')
		await resolver.listReadable(req, 'tenant-a')
		await resolver.listReadable(req, 'tenant-a')
		expect(calls.map((call) => call.overrideAccess)).toEqual([true, false, false])
	})

	it('lists the config goals when the listing fails', async () => {
		const { req, resolver } = over(() => {
			throw new Error('access threw')
		}, false)
		const listed = await resolver.listReadable(req)
		expect(listed.map((entry) => entry.goal.slug)).toEqual(['demo', 'thanks', 'purchase'])
	})

	it('is the config goals on an install without the collection', async () => {
		const listed = await configGoalsResolver(configGoals, false).listReadable(reqWith(docs([])))
		expect(listed.map((entry) => entry.goal.slug)).toEqual(['demo', 'thanks'])
	})
})
