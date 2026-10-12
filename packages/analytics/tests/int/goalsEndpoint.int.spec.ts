import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { makeGoalsHandler } from '../../src/goals/goalsEndpoint'
import { analytics } from '../../src/index'
import { getRuntime, resolveGoalsFor } from '../../src/plugin/runtime'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const GOALS = 'analytics-goals'

const accessUsers: CollectionConfig = { slug: 'access-users', auth: true, fields: [] }

const scopeByEmail: Record<string, string | null> = {
	'a@t.dev': 'tenant-a',
	'b@t.dev': 'tenant-b',
}

const BROKEN_EMAIL = 'broken@t.dev'

const login = async (payload: Payload, email: string) => {
	const password = 'test-pass-1234'
	await payload.create({ collection: 'access-users', data: { email, password } })
	const result = await payload.login({ collection: 'access-users', data: { email, password } })
	return result.user
}

type GoalsBody = {
	goals: Array<{ slug: string; name: string; source: 'builtin' | 'collection' | 'config' }>
	collection: { slug: string } | null
}

const configGoals = [
	{ slug: 'book-demo', name: 'Book a demo', match: { kind: 'goal' as const } },
	{ slug: 'signup', name: 'Signup', match: { kind: 'event' as const, name: 'signup' } },
]

describeForDb('analytics goals endpoint', {}, (db) => {
	let booted: BootedPayload
	let userA: Awaited<ReturnType<typeof login>>
	let userB: Awaited<ReturnType<typeof login>>
	let platformUser: Awaited<ReturnType<typeof login>>
	let brokenUser: Awaited<ReturnType<typeof login>>

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				scope: {
					member: () => true,
					resolve: ({ req }) => {
						const email = (req.user as { email?: string })?.email ?? ''
						if (email === BROKEN_EMAIL) throw new Error('scope resolution boom')
						return scopeByEmail[email] ?? null
					},
				},
				access: {
					crossScope: ({ req }) =>
						(req.user as { email?: string } | null)?.email === 'platform@t.dev',
				},
				goals: { defaults: configGoals, collection: true },
			}),
		})
		userA = await login(booted.payload, 'a@t.dev')
		userB = await login(booted.payload, 'b@t.dev')
		platformUser = await login(booted.payload, 'platform@t.dev')
		brokenUser = await login(booted.payload, BROKEN_EMAIL)
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const handler = makeGoalsHandler()
	const reqFor = (user: unknown): PayloadRequest =>
		({ user, payload: booted.payload }) as unknown as PayloadRequest

	const bodyFor = async (user: unknown, query = ''): Promise<GoalsBody> => {
		const res = await handler({
			...reqFor(user),
			url: `http://localhost/api/_x/goals${query}`,
		})
		expect(res.status).toBe(200)
		return (await res.json()) as GoalsBody
	}

	const createGoal = async (user: unknown, data: Record<string, unknown>) =>
		(await booted.payload.create({
			collection: GOALS as never,
			data: data as never,
			user: user as never,
			overrideAccess: false,
		})) as unknown as { id: number | string }

	const deleteGoal = async (id: number | string) => {
		await booted.payload.delete({ collection: GOALS as never, id, overrideAccess: true })
	}

	it('registers the endpoint under the api route', () => {
		const endpoint = booted.payload.config.endpoints.find(
			(candidate) => candidate.path === '/_x/goals'
		)

		expect(endpoint?.method).toBe('get')
	})

	it('401s an anonymous request', async () => {
		const res = await handler(reqFor(undefined))
		expect(res.status).toBe(401)
	})

	it('lists the config goals tagged as config', async () => {
		const body = await bodyFor(userA)

		expect(body.goals).toEqual([
			{ slug: 'book-demo', name: 'Book a demo', source: 'config' },
			{ slug: 'signup', name: 'Signup', source: 'config' },
		])
	})

	it('reports the goals collection slug when the collection is enabled', async () => {
		const body = await bodyFor(userA)

		expect(body.collection).toEqual({ slug: GOALS })
	})

	it("adds the scope's own collection goals, tagged collection", async () => {
		const goal = await createGoal(userA, {
			name: 'Newsletter',
			slug: 'newsletter',
			match: { kind: 'goal' },
		})
		try {
			const body = await bodyFor(userA)

			expect(body.goals).toContainEqual({
				slug: 'newsletter',
				name: 'Newsletter',
				source: 'collection',
			})
		} finally {
			await deleteGoal(goal.id)
		}
	})

	it('reports a collection goal overriding a config slug as collection', async () => {
		const goal = await createGoal(userA, {
			name: 'Demo request',
			slug: 'book-demo',
			match: { kind: 'goal' },
		})
		try {
			const body = await bodyFor(userA)

			expect(body.goals[0]).toEqual({
				slug: 'book-demo',
				name: 'Demo request',
				source: 'collection',
			})
		} finally {
			await deleteGoal(goal.id)
		}
	})

	it("does not leak another tenant's collection goals", async () => {
		const goal = await createGoal(userA, {
			name: 'Newsletter',
			slug: 'newsletter',
			match: { kind: 'goal' },
		})
		try {
			const body = await bodyFor(userB)

			expect(body.goals.map((entry) => entry.slug)).toEqual(['book-demo', 'signup'])
		} finally {
			await deleteGoal(goal.id)
		}
	})

	it('answers empty for a user whose scope does not resolve and who cannot read across scopes', async () => {
		const stranger = await login(booted.payload, 'stranger@t.dev')
		const body = await bodyFor(stranger)

		expect(body.goals).toEqual([])
		expect(body.collection).toEqual({ slug: GOALS })
	})

	it('answers empty when scope resolution throws, rather than falling back to the config goals', async () => {
		const body = await bodyFor(brokenUser)

		expect(body.goals).toEqual([])
		expect(body.collection).toEqual({ slug: GOALS })
	})

	// The built-in purchase goal is latent: it matches at ingest so a sale counts, but it is
	// not a goal the install has, and every caller here is a picker.
	it('leaves the built-in goal out unless the caller asks for it', async () => {
		const plain = await bodyFor(userA)
		const asked = await bodyFor(userA, '?include=builtin')

		expect(plain.goals.map((entry) => entry.slug)).not.toContain('purchase')
		expect(asked.goals).toContainEqual({ slug: 'purchase', name: 'Purchase', source: 'builtin' })
	})

	it('answers the install-wide goals for a reader crossScope grants', async () => {
		const body = await bodyFor(platformUser)

		expect(body.goals.map((entry) => entry.slug)).toEqual(['book-demo', 'signup'])
	})
})

describeForDb('analytics goals endpoint - no collection', {}, (db) => {
	let booted: BootedPayload
	let user: Awaited<ReturnType<typeof login>>

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				goals: configGoals,
			}),
		})
		user = await login(booted.payload, 'solo@t.dev')
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const handler = makeGoalsHandler()
	const reqFor = (u: unknown): PayloadRequest =>
		({ user: u, payload: booted.payload }) as unknown as PayloadRequest

	it('answers the config goals with a null collection', async () => {
		const res = await handler(reqFor(user))
		expect(res.status).toBe(200)
		const body = (await res.json()) as GoalsBody

		expect(body.collection).toBeNull()
		expect(body.goals).toEqual([
			{ slug: 'book-demo', name: 'Book a demo', source: 'config' },
			{ slug: 'signup', name: 'Signup', source: 'config' },
		])
	})
})

describeForDb('analytics goals endpoint - narrowed collection read access', {}, (db) => {
	let booted: BootedPayload
	let user: Awaited<ReturnType<typeof login>>

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				goals: {
					defaults: configGoals,
					collection: {
						access: {
							read: ({ req }) => (req.user ? { name: { not_equals: 'Board only' } } : false),
						},
					},
				},
			}),
		})
		user = await login(booted.payload, 'editor@t.dev')
		for (const data of [
			{ name: 'Newsletter', slug: 'newsletter', match: { kind: 'goal' } },
			{ name: 'Board only', slug: 'board-target', match: { kind: 'goal' } },
		]) {
			await booted.payload.create({ collection: GOALS as never, data: data as never })
		}
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	it('lists only the collection goals its read access shows the reader, beside the config ones', async () => {
		const res = await makeGoalsHandler()({
			user,
			payload: booted.payload,
			url: 'http://localhost/api/_x/goals',
		} as unknown as PayloadRequest)
		expect(res.status).toBe(200)
		const body = (await res.json()) as GoalsBody
		expect(body.goals).toEqual([
			{ slug: 'book-demo', name: 'Book a demo', source: 'config' },
			{ slug: 'signup', name: 'Signup', source: 'config' },
			{ slug: 'newsletter', name: 'Newsletter', source: 'collection' },
		])
	})

	it('still matches the goal it hides from the reader', async () => {
		const runtime = getRuntime(booted.payload)
		const req = { user, payload: booted.payload } as unknown as PayloadRequest
		const matched = runtime ? await resolveGoalsFor(runtime, req, null) : []
		expect(matched.map((goal) => goal.slug)).toContain('board-target')
	})
})
