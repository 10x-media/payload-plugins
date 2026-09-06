import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig, Payload, PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { makeSourcesHandler } from '../../src/plugin/sourcesEndpoint'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const SLUG = 'analytics-providers'

const accessUsers: CollectionConfig = { slug: 'access-users', auth: true, fields: [] }

const scopeByEmail: Record<string, string | null> = {
	'a@t.dev': 'tenant-a',
	'b@t.dev': 'tenant-b',
	'c@t.dev': 'tenant-c',
}

const BROKEN_EMAIL = 'broken@t.dev'

const login = async (payload: Payload, email: string) => {
	const password = 'test-pass-1234'
	await payload.create({ collection: 'access-users', data: { email, password } })
	const result = await payload.login({ collection: 'access-users', data: { email, password } })
	return result.user
}

type ProviderRow = { id: string | number; name?: string | null }

describeForDb('analytics sources endpoint', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let userA: Awaited<ReturnType<typeof login>>
	let userB: Awaited<ReturnType<typeof login>>
	let userC: Awaited<ReturnType<typeof login>>
	let userBroken: Awaited<ReturnType<typeof login>>

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				scopeResolver: ({ req }) => {
					const email = (req.user as { email?: string })?.email ?? ''
					if (email === BROKEN_EMAIL) throw new Error('scope resolution boom')
					return scopeByEmail[email] ?? null
				},
				access: { platformRead: () => false },
				providers: { collection: true },
			}),
		})
		userA = await login(booted.payload, 'a@t.dev')
		userB = await login(booted.payload, 'b@t.dev')
		userC = await login(booted.payload, 'c@t.dev')
		userBroken = await login(booted.payload, BROKEN_EMAIL)
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const handler = makeSourcesHandler()
	const reqFor = (user: unknown): PayloadRequest =>
		({ user, payload: booted.payload }) as unknown as PayloadRequest

	type SourcesBody = {
		defaultId: string | null
		sources: Array<{
			id: string
			label: string
			kind: 'config' | 'runtime'
			capabilities: { metrics: unknown }
		}>
	}

	it('401s an anonymous request', async () => {
		const res = await handler(reqFor(undefined))
		expect(res.status).toBe(401)
	})

	it('lists config adapters with serialized capabilities and reports the registry default', async () => {
		const res = await handler(reqFor(userC))
		expect(res.status).toBe(200)
		const body = (await res.json()) as SourcesBody
		expect(body.defaultId).toBe('memory')
		const memory = body.sources.find((s) => s.id === 'memory')
		expect(memory).toBeDefined()
		expect(memory?.kind).toBe('config')
		expect(Array.isArray(memory?.capabilities.metrics)).toBe(true)
	})

	it("includes the scope's own runtime providers under instance ids", async () => {
		const doc = (await booted.payload.create({
			collection: SLUG as never,
			data: {
				name: 'A plausible',
				provider: 'plausible',
				enabled: true,
				plausible: { siteId: 'example.com', apiKey: 'plausible-key' },
			} as never,
			user: userA,
			overrideAccess: false,
		})) as unknown as ProviderRow
		try {
			const res = await handler(reqFor(userA))
			expect(res.status).toBe(200)
			const body = (await res.json()) as SourcesBody
			const source = body.sources.find((s) => s.id === `plausible:${doc.id}`)
			expect(source).toBeDefined()
			expect(source?.label).toBe('A plausible')
			expect(source?.kind).toBe('runtime')
		} finally {
			await booted.payload.delete({ collection: SLUG as never, id: doc.id, overrideAccess: true })
		}
	})

	it("does not leak another tenant's runtime providers", async () => {
		const doc = (await booted.payload.create({
			collection: SLUG as never,
			data: {
				name: 'A plausible',
				provider: 'plausible',
				enabled: true,
				plausible: { siteId: 'example.com', apiKey: 'plausible-key' },
			} as never,
			user: userA,
			overrideAccess: false,
		})) as unknown as ProviderRow
		try {
			const res = await handler(reqFor(userB))
			expect(res.status).toBe(200)
			const body = (await res.json()) as SourcesBody
			const source = body.sources.find((s) => s.id === `plausible:${doc.id}`)
			expect(source).toBeUndefined()
		} finally {
			await booted.payload.delete({ collection: SLUG as never, id: doc.id, overrideAccess: true })
		}
	})

	it('answers empty when scope resolution throws, rather than falling back to the config registry', async () => {
		const res = await handler(reqFor(userBroken))
		expect(res.status).toBe(200)
		const body = (await res.json()) as SourcesBody
		expect(body.defaultId).toBeNull()
		expect(body.sources).toEqual([])
	})
})

describeForDb('analytics sources endpoint - null scope gating', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let tenantUser: Awaited<ReturnType<typeof login>>
	let platformUser: Awaited<ReturnType<typeof login>>

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [accessUsers],
			db,
			plugin: analytics({
				adapters: [memoryAdapter()],
				scopeResolver: () => null,
				access: {
					platformRead: ({ req }) =>
						(req.user as { email?: string } | null)?.email === 'platform@t.dev',
				},
			}),
		})
		tenantUser = await login(booted.payload, 'tenant@t.dev')
		platformUser = await login(booted.payload, 'platform@t.dev')
	}, 240_000)

	afterAll(async () => {
		await booted.stop()
	})

	const handler = makeSourcesHandler()
	const reqFor = (user: unknown): PayloadRequest =>
		({ user, payload: booted.payload }) as unknown as PayloadRequest

	type SourcesBody = { defaultId: string | null; sources: unknown[] }

	it('answers empty for a tenant user whose resolver yields no scope', async () => {
		const res = await handler(reqFor(tenantUser))
		expect(res.status).toBe(200)
		const body = (await res.json()) as SourcesBody
		expect(body.defaultId).toBeNull()
		expect(body.sources).toEqual([])
	})

	it('answers the full registry for a platformRead-granted user', async () => {
		const res = await handler(reqFor(platformUser))
		expect(res.status).toBe(200)
		const body = (await res.json()) as SourcesBody
		expect(body.defaultId).toBe('memory')
		expect(body.sources.length).toBeGreaterThan(0)
	})
})
