import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { analytics } from '../../src/index'
import { getRuntime, resolveRegistryFor } from '../../src/plugin/runtime'
import { PROVIDER_SECRET_MASK, PROVIDER_SECRET_REVEAL_CONTEXT } from '../../src/providers/secrets'
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
				provider: 'plausible',
				enabled: true,
				plausible: { siteId: 'example.com', apiKey: 'plausible-key' },
			} as never,
			overrideAccess: true,
		})

		const after = await registryFor(null)
		expect(after.all().map((a) => a.id)).toEqual(['memory', 'plausible'])
		expect(after.get('plausible').isConfigured()).toBe(true)
		expect(after.default().id).toBe('memory')
	})

	it('masks secrets on reads and reveals them only for the internal context', async () => {
		const masked = await booted.payload.find({
			collection: SLUG as never,
			overrideAccess: true,
		})
		const maskedDoc = masked.docs[0] as unknown as ProviderRow
		expect(maskedDoc.plausible?.apiKey).toBe(PROVIDER_SECRET_MASK)

		const revealed = await booted.payload.find({
			collection: SLUG as never,
			overrideAccess: true,
			context: { [PROVIDER_SECRET_REVEAL_CONTEXT]: true },
		})
		const revealedDoc = revealed.docs[0] as unknown as ProviderRow
		expect(revealedDoc.plausible?.apiKey).toBe('plausible-key')
	})

	it('preserves the stored secret when the masked placeholder round-trips on update', async () => {
		const { docs } = await booted.payload.find({ collection: SLUG as never, overrideAccess: true })
		const doc = docs[0] as unknown as ProviderRow
		await booted.payload.update({
			collection: SLUG as never,
			id: doc.id,
			data: { plausible: { siteId: 'example.com', apiKey: PROVIDER_SECRET_MASK } } as never,
			overrideAccess: true,
		})
		const revealed = await booted.payload.find({
			collection: SLUG as never,
			overrideAccess: true,
			context: { [PROVIDER_SECRET_REVEAL_CONTEXT]: true },
		})
		const revealedDoc = revealed.docs[0] as unknown as ProviderRow
		expect(revealedDoc.plausible?.apiKey).toBe('plausible-key')
		const registry = await registryFor(null)
		expect(registry.get('plausible').isConfigured()).toBe(true)
	})

	it('scopes provider documents: a scoped doc joins only its scope registry', async () => {
		await booted.payload.create({
			collection: SLUG as never,
			data: {
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
