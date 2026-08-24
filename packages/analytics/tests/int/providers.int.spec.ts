import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { getRuntime, resolveRegistryFor } from '../../src/plugin/runtime'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const SLUG = 'analytics-providers'

type ProviderRow = { id: string | number; plausible?: { apiKey?: string | null } }

describeForDb('analytics providers collection', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({ adapters: [memoryAdapter()], providers: { collection: true } }),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	const registryFor = async (scope: string | null) => {
		const runtime = getRuntime(booted.payload)
		if (!runtime) throw new Error('runtime missing')
		return resolveRegistryFor(runtime, { payload: booted.payload, scope })
	}

	it('registers the providers collection', () => {
		const slugs = (booted.payload.config.collections ?? []).map((c) => c.slug)
		expect(slugs).toContain(SLUG)
	})

	it('resolves an enabled provider document into the scope registry', async () => {
		const before = await registryFor(null)
		expect(before.all().map((a) => a.id)).toEqual(['memory'])

		await booted.payload.create({
			collection: SLUG as never,
			data: {
				name: 'Test provider',
				provider: 'plausible',
				enabled: true,
				plausible: { siteId: 'example.com', apiKey: 'plausible-key' },
			} as never,
			overrideAccess: true,
		})

		const after = await registryFor(null)
		expect(after.all().map((a) => a.id)).toEqual(['memory', 'plausible'])
		expect(after.default().id).toBe('memory')
	})

	it('configures the resolved provider adapter from its stored secret', async () => {
		const after = await registryFor(null)
		expect(after.get('plausible').isConfigured()).toBe(true)
	})

	it('stores credentials encrypted and strips them from ordinary reads', async () => {
		const created = await booted.payload.create({
			collection: SLUG as never,
			data: {
				name: 'PH',
				provider: 'posthog',
				enabled: true,
				posthog: { projectId: '123', apiKey: 'phx_secret_value_abcd' },
			} as never,
			overrideAccess: true,
		})
		const read = (await booted.payload.findByID({
			collection: SLUG as never,
			id: (created as { id: string | number }).id,
			overrideAccess: true,
		})) as { posthog?: { apiKey?: unknown } }
		expect(read.posthog?.apiKey).toBeUndefined()

		const { withRawEncrypted } = await import('@10x-media/fields/encrypted')
		const { createLocalReq } = await import('payload')
		const req = await createLocalReq({}, booted.payload)
		const raw = (await withRawEncrypted(req, () =>
			booted.payload.findByID({
				collection: SLUG as never,
				id: (created as { id: string | number }).id,
				req,
				overrideAccess: true,
			})
		)) as { posthog?: { apiKey?: string } }
		expect(raw.posthog?.apiKey).toMatch(/^pfe1\./)
	})

	it('the provider source resolves adapters with working decrypted credentials', async () => {
		try {
			const registry = await registryFor(null)
			const adapter = registry.all().find((a) => a.id === 'posthog')
			expect(adapter?.isConfigured()).toBe(true)
		} finally {
			// clears the fixture so later tests' scope/registry assertions stay exact,
			// even if the assertion above fails
			await booted.payload.delete({
				collection: SLUG as never,
				where: { provider: { equals: 'posthog' } },
				overrideAccess: true,
			})
		}
	})

	it("resolves the scope's healthy providers when another document's ciphertext is corrupted", async () => {
		const scope = 'corrupt-test'
		await booted.payload.create({
			collection: SLUG as never,
			data: {
				name: 'Healthy',
				provider: 'plausible',
				enabled: true,
				scope,
				plausible: { siteId: 'healthy.example', apiKey: 'good-key' },
			} as never,
			overrideAccess: true,
		})
		const poisoned = await booted.payload.create({
			collection: SLUG as never,
			data: {
				name: 'Poisoned',
				provider: 'posthog',
				enabled: true,
				scope,
				posthog: { projectId: '123', apiKey: 'about-to-be-corrupted' },
			} as never,
			overrideAccess: true,
		})
		const poisonedId = (poisoned as { id: string | number }).id

		const { withRawEncrypted } = await import('@10x-media/fields/encrypted')
		const { createLocalReq } = await import('payload')
		const req = await createLocalReq({}, booted.payload)
		const raw = (await withRawEncrypted(req, () =>
			booted.payload.findByID({
				collection: SLUG as never,
				id: poisonedId,
				req,
				overrideAccess: true,
			})
		)) as { posthog?: { apiKey?: string } }
		const stored = raw.posthog?.apiKey
		if (!stored) throw new Error('expected a stored ciphertext to corrupt')
		// flip the tail of the auth tag segment; same length and charset, so the wire
		// format still parses, but the GCM tag no longer authenticates
		const corrupted = `${stored.slice(0, -4)}${stored.endsWith('AAAA') ? 'BBBB' : 'AAAA'}`
		await withRawEncrypted(req, () =>
			booted.payload.update({
				collection: SLUG as never,
				id: poisonedId,
				data: { posthog: { projectId: '123', apiKey: corrupted } } as never,
				req,
				overrideAccess: true,
			})
		)

		try {
			const registry = await registryFor(scope)
			expect(registry.all().map((a) => a.id)).toEqual(['memory', 'plausible'])
		} finally {
			// clears both fixtures so later tests' scope/registry assertions stay
			// exact, even if the assertion above fails
			await booted.payload.delete({
				collection: SLUG as never,
				where: { scope: { equals: scope } },
				overrideAccess: true,
			})
		}
	})

	it('scopes provider documents: a scoped doc joins only its scope registry', async () => {
		await booted.payload.create({
			collection: SLUG as never,
			data: {
				name: 'Test provider',
				provider: 'umami',
				enabled: true,
				scope: 't1',
				umami: { websiteId: 'w', apiKey: 'umami-key' },
			} as never,
			overrideAccess: true,
		})
		const t1 = await registryFor('t1')
		expect(t1.all().map((a) => a.id)).toEqual(['memory', 'umami'])
		const nullScope = await registryFor(null)
		expect(nullScope.all().map((a) => a.id)).toEqual(['memory', 'plausible'])
		const t2 = await registryFor('t2')
		expect(t2.all().map((a) => a.id)).toEqual(['memory'])
	})

	it('drops a provider immediately after it is disabled (hook invalidation beats the TTL)', async () => {
		const { docs } = await booted.payload.find({
			collection: SLUG as never,
			where: { provider: { equals: 'plausible' } },
			overrideAccess: true,
		})
		const doc = docs[0] as unknown as ProviderRow
		await booted.payload.update({
			collection: SLUG as never,
			id: doc.id,
			data: { enabled: false } as never,
			overrideAccess: true,
		})
		const registry = await registryFor(null)
		expect(registry.all().map((a) => a.id)).toEqual(['memory'])
	})

	it('drops a provider immediately after delete', async () => {
		await booted.payload.delete({
			collection: SLUG as never,
			where: { provider: { equals: 'umami' } },
			overrideAccess: true,
		})
		const t1 = await registryFor('t1')
		expect(t1.all().map((a) => a.id)).toEqual(['memory'])
	})
})

describeForDb('analytics providers.resolve escape hatch', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	const scopesSeen: Array<string | null> = []

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: analytics({
				adapters: [memoryAdapter()],
				providers: {
					resolve: ({ scope }) => {
						scopesSeen.push(scope)
						return scope === 't1' ? [{ ...memoryAdapter(), id: 'custom' }] : []
					},
				},
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('does not register the providers collection for resolve-only setups', () => {
		const slugs = (booted.payload.config.collections ?? []).map((c) => c.slug)
		expect(slugs).not.toContain(SLUG)
	})

	it('layers resolve results onto the static base per scope', async () => {
		const runtime = getRuntime(booted.payload)
		if (!runtime) throw new Error('runtime missing')
		const t1 = await resolveRegistryFor(runtime, { payload: booted.payload, scope: 't1' })
		expect(t1.all().map((a) => a.id)).toEqual(['memory', 'custom'])
		const nullScope = await resolveRegistryFor(runtime, { payload: booted.payload, scope: null })
		expect(nullScope.all().map((a) => a.id)).toEqual(['memory'])
		expect(scopesSeen).toEqual(['t1', null])
	})
})
