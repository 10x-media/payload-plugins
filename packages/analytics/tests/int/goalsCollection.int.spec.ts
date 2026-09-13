import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Endpoint, Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { GOALS_SLUG } from '../../src/goals/collection'
import type { Goal } from '../../src/goals/types'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { getRuntime } from '../../src/plugin/runtime'
import { ingestRequest } from './ingestRequest'

const DAY_MS = 86_400_000

const configGoals: Goal[] = [
	{ slug: 'purchase', name: 'Purchase (config)', match: { kind: 'goal' }, value: { fixed: 5 } },
]

const ingestInto = async (
	payload: Payload,
	body: Record<string, unknown>,
	headers?: Record<string, string>
): Promise<void> => {
	const endpoint = (payload.config.endpoints ?? []).find(
		(e): e is Endpoint => typeof e === 'object' && e.path === '/analytics/ingest'
	)
	if (!endpoint || typeof endpoint.handler !== 'function') {
		throw new Error('ingest endpoint not registered')
	}
	const res = await endpoint.handler(
		ingestRequest(payload, { hostname: 'h', ...body }, headers ?? {})
	)
	expect(res.status).toBe(202)
}

describeForDb('analytics goals collection: unscoped', { dbs: ['mongo'] }, (db) => {
	const adapter = native()
	let booted: BootedPayload
	let range: { start: Date; end: Date }

	const create = (data: Record<string, unknown>) =>
		booted.payload.create({ collection: GOALS_SLUG as never, data: data as never })

	const byGoal = async (): Promise<Record<string, { conversions: number; revenue: number }>> => {
		const result = await adapter.query(
			{ metrics: ['conversions', 'revenue'], dimensions: ['goal'], dateRange: range },
			{}
		)
		return Object.fromEntries(
			result.rows.map((r) => [String(r.dimensions?.goal), r.metrics])
		) as Record<string, { conversions: number; revenue: number }>
	}

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [adapter],
				goals: { defaults: configGoals, collection: true },
			}),
		})
		const now = Date.now()
		range = { start: new Date(now - DAY_MS), end: new Date(now + 60_000) }
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('registers the collection under the configured slug', () => {
		expect(booted.payload.config.collections.some((c) => c.slug === GOALS_SLUG)).toBe(true)
	})

	it('matches an editor-created goal at ingest', async () => {
		await create({ name: 'Signup', slug: 'signup', match: { kind: 'event', name: 'signup_done' } })
		await ingestInto(booted.payload, { type: 'event', name: 'signup_done', path: '/pricing' })
		expect((await byGoal()).signup).toEqual({ conversions: 1, revenue: 0 })
	})

	it('lets a collection goal win over the config goal with the same slug', async () => {
		await create({
			name: 'Purchase (edited)',
			slug: 'purchase',
			match: { kind: 'goal' },
			value: { fixed: 42 },
		})
		await ingestInto(booted.payload, { type: 'goal', name: 'purchase', path: '/checkout' })
		// 42 from the collection document, not the config goal's 5.
		expect((await byGoal()).purchase).toEqual({ conversions: 1, revenue: 42 })
	})

	it('stops matching a goal the editor disables', async () => {
		const doc = await create({
			name: 'Trial',
			slug: 'trial',
			match: { kind: 'event', name: 'trial_started' },
		})
		await ingestInto(booted.payload, { type: 'event', name: 'trial_started', path: '/trial' })
		expect((await byGoal()).trial).toEqual({ conversions: 1, revenue: 0 })
		await booted.payload.update({
			collection: GOALS_SLUG as never,
			id: (doc as { id: string | number }).id,
			data: { enabled: false } as never,
		})
		await ingestInto(booted.payload, { type: 'event', name: 'trial_started', path: '/trial' })
		expect((await byGoal()).trial).toEqual({ conversions: 1, revenue: 0 })
	})

	it('refuses a second document with a slug already in use', async () => {
		await create({ name: 'Demo', slug: 'demo', match: { kind: 'goal' } })
		await expect(
			create({ name: 'Demo again', slug: 'demo', match: { kind: 'goal' } })
		).rejects.toThrow()
	})

	it('refuses a slug that is not kebab-case', async () => {
		await expect(
			create({ name: 'Book Demo', slug: 'Book Demo', match: { kind: 'goal' } })
		).rejects.toThrow()
	})
})

const accessUsers: CollectionConfig = { slug: 'access-users', auth: true, fields: [] }

const scopeByEmail: Record<string, string | null> = {
	'a@t.dev': 'tenant-a',
	'b@t.dev': 'tenant-b',
	'root@t.dev': null,
}

const login = async (payload: Payload, email: string) => {
	const password = 'test-pass-1234'
	await payload.create({ collection: 'access-users', data: { email, password } })
	const result = await payload.login({ collection: 'access-users', data: { email, password } })
	return result.user
}

describeForDb('analytics goals collection: scoped', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let userA: Awaited<ReturnType<typeof login>>
	let userB: Awaited<ReturnType<typeof login>>
	let userRoot: Awaited<ReturnType<typeof login>>
	let goalA: { id: string | number }

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [native()],
				scopeResolver: ({ req }) =>
					scopeByEmail[(req.user as { email?: string })?.email ?? ''] ?? null,
				access: {
					platformRead: ({ req }) => (req.user as { email?: string })?.email === 'root@t.dev',
				},
				goals: { collection: true },
			}),
		})
		userA = await login(booted.payload, 'a@t.dev')
		userB = await login(booted.payload, 'b@t.dev')
		userRoot = await login(booted.payload, 'root@t.dev')
		goalA = (await booted.payload.create({
			collection: GOALS_SLUG as never,
			data: { name: 'Signup', slug: 'signup', match: { kind: 'goal' } } as never,
			user: userA,
			overrideAccess: false,
		})) as unknown as { id: string | number }
		await booted.payload.create({
			collection: GOALS_SLUG as never,
			data: {
				name: 'Signup B',
				slug: 'signup',
				match: { kind: 'goal' },
				scope: 'tenant-b',
			} as never,
			user: userRoot,
			overrideAccess: false,
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('stamps the creating tenant’s scope', () => {
		expect((goalA as unknown as { scope?: string }).scope).toBe('tenant-a')
	})

	it('refuses a scope forged in the request body', async () => {
		await expect(
			booted.payload.create({
				collection: GOALS_SLUG as never,
				data: {
					name: 'Sneaky',
					slug: 'sneaky',
					match: { kind: 'goal' },
					scope: 'tenant-b',
				} as never,
				user: userA,
				overrideAccess: false,
			})
		).rejects.toThrow()
	})

	it('keeps the same slug usable once per scope', async () => {
		await expect(
			booted.payload.create({
				collection: GOALS_SLUG as never,
				data: { name: 'Signup again', slug: 'signup', match: { kind: 'goal' } } as never,
				user: userA,
				overrideAccess: false,
			})
		).rejects.toThrow()
	})

	it('hides a tenant’s goals from another tenant', async () => {
		const { docs } = await booted.payload.find({
			collection: GOALS_SLUG as never,
			user: userB,
			overrideAccess: false,
		})
		expect(docs.every((d) => (d as { scope?: string }).scope === 'tenant-b')).toBe(true)
		await expect(
			booted.payload.findByID({
				collection: GOALS_SLUG as never,
				id: goalA.id,
				user: userA,
				overrideAccess: false,
			})
		).resolves.toBeDefined()
		await expect(
			booted.payload.findByID({
				collection: GOALS_SLUG as never,
				id: goalA.id,
				user: userB,
				overrideAccess: false,
			})
		).rejects.toThrow()
	})

	it('lets the platform admin read every scope', async () => {
		const { docs } = await booted.payload.find({
			collection: GOALS_SLUG as never,
			user: userRoot,
			overrideAccess: false,
		})
		expect(new Set(docs.map((d) => (d as { scope?: string }).scope))).toEqual(
			new Set(['tenant-a', 'tenant-b'])
		)
	})

	it('resolves each scope only its own goals', async () => {
		const runtime = getRuntime(booted.payload)
		const req = { payload: booted.payload } as unknown as PayloadRequest
		expect((await runtime?.resolveGoals?.(req, 'tenant-a'))?.map((g) => g.name)).toEqual(['Signup'])
		expect((await runtime?.resolveGoals?.(req, 'tenant-b'))?.map((g) => g.name)).toEqual([
			'Signup B',
		])
		expect(await runtime?.resolveGoalsDetailed?.(req, 'tenant-a')).toEqual([
			{ goal: expect.objectContaining({ slug: 'signup' }), source: 'collection' },
		])
	})
})
