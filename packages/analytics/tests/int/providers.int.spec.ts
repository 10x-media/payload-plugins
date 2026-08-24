import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { PayloadRequest } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { native } from '../../src/native/nativeAdapter'
import { getRuntime, resolveRegistryFor } from '../../src/plugin/runtime'
import { SYNC_TASK_SLUG } from '../../src/sync/syncTask'
import { memoryAdapter } from '../../src/testing/memoryAdapter'

const SLUG = 'analytics-providers'

type ProviderRow = { id: string | number; plausible?: { apiKey?: string | null } }

describeForDb('analytics providers collection', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	let plausibleId: string | number
	let posthogId: string | number

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

		const created = await booted.payload.create({
			collection: SLUG as never,
			data: {
				name: 'Test provider',
				provider: 'plausible',
				enabled: true,
				plausible: { siteId: 'example.com', apiKey: 'plausible-key' },
			} as never,
			overrideAccess: true,
		})
		plausibleId = (created as ProviderRow).id

		const after = await registryFor(null)
		expect(after.all().map((a) => a.id)).toEqual(['memory', `plausible:${plausibleId}`])
		expect(after.default().id).toBe('memory')
	})

	it('configures the resolved provider adapter from its stored secret', async () => {
		const after = await registryFor(null)
		expect(after.get(`plausible:${plausibleId}`).isConfigured()).toBe(true)
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
		posthogId = (created as ProviderRow).id
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
			const adapter = registry.all().find((a) => a.id === `posthog:${posthogId}`)
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
		const healthy = await booted.payload.create({
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
		const healthyId = (healthy as { id: string | number }).id
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
			expect(registry.all().map((a) => a.id)).toEqual(['memory', `plausible:${healthyId}`])
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
		const umami = await booted.payload.create({
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
		const umamiId = (umami as { id: string | number }).id
		const t1 = await registryFor('t1')
		expect(t1.all().map((a) => a.id)).toEqual(['memory', `umami:${umamiId}`])
		const nullScope = await registryFor(null)
		expect(nullScope.all().map((a) => a.id)).toEqual(['memory', `plausible:${plausibleId}`])
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

	it('two provider documents of one type in one scope both resolve', async () => {
		const scope = 'multi-posthog'
		const docA = await booted.payload.create({
			collection: SLUG as never,
			data: {
				name: 'PH A',
				provider: 'posthog',
				enabled: true,
				scope,
				posthog: { projectId: 'proj-a', apiKey: 'key-a-secret-value' },
			} as never,
			overrideAccess: true,
		})
		const docB = await booted.payload.create({
			collection: SLUG as never,
			data: {
				name: 'PH B',
				provider: 'posthog',
				enabled: true,
				scope,
				posthog: { projectId: 'proj-b', apiKey: 'key-b-secret-value' },
			} as never,
			overrideAccess: true,
		})
		const idA = (docA as { id: string | number }).id
		const idB = (docB as { id: string | number }).id
		try {
			const registry = await registryFor(scope)
			const expectedIdA = `posthog:${idA}`
			const expectedIdB = `posthog:${idB}`
			expect(registry.all().map((a) => a.id)).toEqual(
				expect.arrayContaining([expectedIdA, expectedIdB])
			)
			const adapterA = registry.get(expectedIdA)
			const adapterB = registry.get(expectedIdB)
			expect(adapterA.label).toBe('PH A')
			expect(adapterB.label).toBe('PH B')
			expect(adapterA).not.toBe(adapterB)
			expect(adapterA.isConfigured()).toBe(true)
			expect(adapterB.isConfigured()).toBe(true)
		} finally {
			await booted.payload.delete({
				collection: SLUG as never,
				where: { scope: { equals: scope } },
				overrideAccess: true,
			})
		}
	})

	it('validates encryption keys at boot', async () => {
		// Wiring coverage: all healthy boots in this describe block execute onInit with
		// providers.collection enabled, so onInit failure here would reject the entire
		// boot in this describe block's beforeAll. This test verifies the failure path
		// leak-free by calling validateEncryptedBoot directly against the booted payload.
		const { validateEncryptedBoot } = await import('@10x-media/fields/encrypted')
		await expect(
			validateEncryptedBoot(booted.payload, {
				active: 'k1',
				keys: {
					k1: () => Promise.reject(new Error('kms down')),
				},
			})
		).rejects.toThrow('kms down')
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

type ConfiguredTask = {
	slug?: string
	handler?: (args: { req: PayloadRequest }) => Promise<unknown>
}

describeForDb('analytics sync tier: runtime provider instance ids', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	const DAY = 86_400_000
	const mem = memoryAdapter()
	const instanceAdapter = { ...mem, id: 'memory:doc1', label: 'Tenant memory' }

	beforeAll(async () => {
		for (let offset = 0; offset < 3; offset++) {
			const t = new Date(Date.now() - offset * DAY)
			mem.record({ path: '/p', timestamp: t, visitor: 'a' })
		}
		booted = await bootPayload({
			plugin: analytics({
				adapters: [native()],
				sync: true,
				providers: { resolve: async () => [instanceAdapter] },
			}),
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('syncs a runtime provider onto analytics-daily rows keyed by its instance id', async () => {
		const config = booted.payload.config as unknown as { jobs?: { tasks?: ConfiguredTask[] } }
		const task = (config.jobs?.tasks ?? []).find((t) => t.slug === SYNC_TASK_SLUG)
		if (!task || typeof task.handler !== 'function') {
			throw new Error('analytics-sync task missing from payload.config.jobs.tasks')
		}
		const req = { payload: booted.payload } as unknown as PayloadRequest
		await task.handler({ req })

		const { docs } = await booted.payload.find({
			collection: 'analytics-daily' as never,
			where: { source: { equals: 'memory:doc1' } },
			pagination: false,
			overrideAccess: true,
		})
		expect(docs.length).toBeGreaterThan(0)
		expect(docs.every((d) => (d as unknown as { source: string }).source === 'memory:doc1')).toBe(
			true
		)
	})
})
