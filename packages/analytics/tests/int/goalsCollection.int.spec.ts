import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Endpoint, Payload, PayloadRequest } from 'payload'
import { handleEndpoints } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import type { TrackerConfig } from '../../src/capture/trackerConfig'
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

describeForDb('analytics goals collection: unscoped', {}, (db) => {
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
	// The platform admin resolves to a tenant of its own, so an install-wide write cannot
	// quietly borrow that scope.
	'admin@t.dev': 'tenant-a',
	'root@t.dev': null,
}

const PLATFORM_EMAILS = new Set(['root@t.dev', 'admin@t.dev'])

const emailOf = (req: { user?: unknown }): string => (req.user as { email?: string })?.email ?? ''

const login = async (payload: Payload, email: string) => {
	const password = 'test-pass-1234'
	await payload.create({ collection: 'access-users', data: { email, password } })
	const result = await payload.login({ collection: 'access-users', data: { email, password } })
	return result.user
}

describeForDb('analytics goals collection: scoped', {}, (db) => {
	let booted: BootedPayload
	let userA: Awaited<ReturnType<typeof login>>
	let userB: Awaited<ReturnType<typeof login>>
	let userRoot: Awaited<ReturnType<typeof login>>
	let userAdmin: Awaited<ReturnType<typeof login>>
	let goalA: { id: string | number }

	const createAs = (
		user: Awaited<ReturnType<typeof login>>,
		data: Record<string, unknown>
	): Promise<{ id: string | number; scope?: string | null }> =>
		booted.payload.create({
			collection: GOALS_SLUG as never,
			data: data as never,
			user,
			overrideAccess: false,
		}) as unknown as Promise<{ id: string | number; scope?: string | null }>

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [native()],
				scopeResolver: ({ req }) => scopeByEmail[emailOf(req)] ?? null,
				access: { platformRead: ({ req }) => PLATFORM_EMAILS.has(emailOf(req)) },
				goals: { collection: true },
			}),
		})
		userA = await login(booted.payload, 'a@t.dev')
		userB = await login(booted.payload, 'b@t.dev')
		userRoot = await login(booted.payload, 'root@t.dev')
		userAdmin = await login(booted.payload, 'admin@t.dev')
		goalA = await createAs(userA, { name: 'Signup', slug: 'signup', match: { kind: 'goal' } })
		await createAs(userRoot, {
			name: 'Signup B',
			slug: 'signup',
			match: { kind: 'goal' },
			scope: 'tenant-b',
		})
		await createAs(userRoot, {
			name: 'B only',
			slug: 'b-only',
			match: { kind: 'goal' },
			scope: 'tenant-b',
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('stamps the creating tenant’s scope', () => {
		expect((goalA as { scope?: string }).scope).toBe('tenant-a')
	})

	it('refuses a scope forged in the request body', async () => {
		await expect(
			createAs(userA, {
				name: 'Sneaky',
				slug: 'sneaky',
				match: { kind: 'goal' },
				scope: 'tenant-b',
			})
		).rejects.toThrow()
	})

	it('answers a forged scope with the stamp, never with a slug-taken verdict', async () => {
		// 'b-only' exists in tenant-b and nowhere else. Checking uniqueness under the forged
		// scope would answer "slug taken" here, telling tenant A what tenant B owns.
		await expect(
			createAs(userA, {
				name: 'Probe',
				slug: 'b-only',
				match: { kind: 'goal' },
				scope: 'tenant-b',
			})
		).rejects.toThrow(/cannot create a provider for another scope/)
	})

	it('keeps the same slug usable once per scope', async () => {
		await expect(
			createAs(userA, { name: 'Signup again', slug: 'signup', match: { kind: 'goal' } })
		).rejects.toMatchObject({ data: { errors: [{ path: 'slug' }] } })
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

	it('refuses a cross-tenant update or delete', async () => {
		await expect(
			booted.payload.update({
				collection: GOALS_SLUG as never,
				id: goalA.id,
				data: { name: 'Hijacked' } as never,
				user: userB,
				overrideAccess: false,
			})
		).rejects.toThrow()
		await expect(
			booted.payload.delete({
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
		const scopes = docs.map((d) => (d as { scope?: string }).scope)
		expect(scopes).toContain('tenant-a')
		expect(scopes).toContain('tenant-b')
	})

	it('resolves each scope only its own goals', async () => {
		const runtime = getRuntime(booted.payload)
		const req = { payload: booted.payload } as unknown as PayloadRequest
		expect((await runtime?.resolveGoals?.(req, 'tenant-a'))?.map((g) => g.name)).toEqual(['Signup'])
		expect(new Set((await runtime?.resolveGoals?.(req, 'tenant-b'))?.map((g) => g.name))).toEqual(
			new Set(['Signup B', 'B only'])
		)
		expect(await runtime?.resolveGoalsDetailed?.(req, 'tenant-a')).toEqual([
			{ goal: expect.objectContaining({ slug: 'signup' }), source: 'collection' },
		])
	})

	it('checks a platform admin’s install-wide write against install-wide goals only', async () => {
		// The admin resolves to tenant-a, which already owns 'signup'; an install-wide write
		// is a different neighbourhood and must be accepted.
		const installWide = await createAs(userAdmin, {
			name: 'Signup (install-wide)',
			slug: 'signup',
			match: { kind: 'goal' },
		})
		expect(installWide.scope ?? null).toBeNull()
		await expect(
			createAs(userAdmin, {
				name: 'Signup (install-wide again)',
				slug: 'signup',
				match: { kind: 'goal' },
			})
		).rejects.toMatchObject({ data: { errors: [{ path: 'slug' }] } })
	})
})

describeForDb('analytics goals collection: tracker config', {}, (db) => {
	let booted: BootedPayload

	const trackerGoals = async (origin: string): Promise<TrackerConfig['goals']> => {
		const res = await handleEndpoints({
			config: booted.payload.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`${origin}/api/analytics/tracker`),
		})
		expect(res.status).toBe(200)
		return ((await res.json()) as TrackerConfig).goals
	}

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				scopeResolver: ({ req }) => req.host?.split(':')[0] ?? null,
				access: { platformRead: () => true },
				goals: { defaults: configGoals, collection: true },
			}),
		})
		await booted.payload.create({
			collection: GOALS_SLUG as never,
			data: {
				name: 'Newsletter (tenant A)',
				slug: 'newsletter',
				match: { kind: 'event', name: 'subscribed' },
				value: { fixed: 12 },
				currency: 'EUR',
				scope: 'tenant-a.test',
			} as never,
		})
		await booted.payload.create({
			collection: GOALS_SLUG as never,
			data: {
				name: 'B only',
				slug: 'b-only',
				match: { kind: 'goal' },
				scope: 'tenant-b.test',
			} as never,
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('serves an editor-created goal to the browser, with its value and without its name', async () => {
		const goals = await trackerGoals('http://tenant-a.test')
		expect(goals).toContainEqual({
			slug: 'newsletter',
			match: { kind: 'event', name: 'subscribed' },
			value: { fixed: 12 },
			currency: 'EUR',
		})
		const json = JSON.stringify(goals)
		expect(json).not.toContain('Newsletter (tenant A)')
		expect(json).not.toContain('scope')
	})

	it('keeps another scope’s goals out of the response', async () => {
		expect((await trackerGoals('http://tenant-a.test')).map((g) => g.slug)).toEqual([
			'purchase',
			'newsletter',
		])
		expect((await trackerGoals('http://tenant-b.test')).map((g) => g.slug)).toEqual([
			'purchase',
			'b-only',
		])
	})
})

describeForDb('analytics goals collection: scope field boot check', {}, (db) => {
	let booted: BootedPayload

	/** Stands in for a tenant plugin, which registers its own field after this plugin runs. */
	const hostScopeField = (collection: CollectionConfig): CollectionConfig => ({
		...collection,
		fields: [...collection.fields, { name: 'tenant', type: 'text' }],
	})

	beforeAll(async () => {
		booted = await bootPayload({
			db,
			plugin: analytics({
				adapters: [native()],
				scopeResolver: () => 'tenant-a',
				goals: { collection: { scopeField: 'tenant', overrides: hostScopeField } },
			}),
		})
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('leaves the scope field to the host and boots on it', () => {
		const collection = booted.payload.config.collections.find((c) => c.slug === GOALS_SLUG)
		expect(collection?.fields.some((f) => 'name' in f && f.name === 'tenant')).toBe(true)
		expect(collection?.fields.some((f) => 'name' in f && f.name === 'scope')).toBe(false)
	})

	it('fails the boot when nothing registered the named scope field', async () => {
		await expect(
			bootPayload({
				db,
				attachTo: booted,
				plugin: analytics({
					adapters: [native()],
					scopeResolver: () => 'tenant-a',
					goals: { collection: { scopeField: 'tenant' } },
				}),
			})
		).rejects.toThrow(
			'analytics: goals.collection.scopeField "tenant" does not exist on analytics-goals; register the collection with your tenant plugin or use the default scope field'
		)
	})
})
