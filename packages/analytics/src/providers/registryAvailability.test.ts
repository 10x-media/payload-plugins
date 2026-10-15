import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../core/registry'
import { memoryAdapter } from '../testing/memoryAdapter'
import type { ProviderId } from './factory'
import { resolveHostPolicy } from './hosts'
import { createProviderRegistry } from './registry'

vi.mock('../plugin/encrypted', () => ({
	loadEncrypted: async () => ({
		decryptFieldValue: async (_payload: unknown, { value }: { value: string }) => value,
		withRawEncrypted: async <T>(_req: unknown, work: () => Promise<T>): Promise<T> => work(),
	}),
}))

vi.mock('payload', async (importOriginal) => ({
	...(await importOriginal<typeof import('payload')>()),
	createLocalReq: async () => ({}),
}))

const AT = '2026-10-07T12:00:00.000Z'

type Stored = Record<string, unknown> & { id: string; provider: string }

const plausibleDoc = (id: string, over: Record<string, unknown> = {}): Stored => ({
	id,
	name: `Plausible ${id}`,
	provider: 'plausible',
	enabled: true,
	updatedAt: AT,
	scope: 'tenant-a',
	plausible: { siteId: 'example.com', apiKey: 'key' },
	...over,
})

/** An instance holding `docs`, probed through `payload.db.find` and read in full through `payload.find`. */
const instanceWith = (docs: Stored[]) => {
	const probeFind = vi.fn(async () => ({
		docs: docs.map(({ id, updatedAt, enabled, provider, scope, isDefault }) => ({
			id,
			updatedAt,
			enabled,
			provider,
			scope,
			isDefault,
		})),
	}))
	const documentFind = vi.fn(async (args: { where: { and: Array<Record<string, unknown>> } }) => {
		const ids = (args.where.and[0] as { id: { in: string[] } }).id.in
		return { docs: docs.filter((doc) => ids.includes(doc.id)).map((doc) => structuredClone(doc)) }
	})
	const payload = {
		collections: { 'analytics-providers': {} },
		db: { find: probeFind, defaultIDType: 'text' },
		find: documentFind,
		logger: { warn: vi.fn() },
	} as unknown as Payload
	return { payload, documentFind }
}

const native = { ...memoryAdapter(), id: 'native' }

const registryOf = (payload: Payload, types?: ProviderId[]) =>
	createProviderRegistry({
		payload,
		plan: {
			kind: 'collection',
			slug: 'analytics-providers',
			scopeField: 'scope',
			nativeAdapter: native,
			...(types ? { types } : {}),
		},
		base: { adapters: [native] },
		registry: createRegistry([native]),
		narrow: (scoped) => scoped,
		hosts: resolveHostPolicy(undefined),
		fetch: async () => new Response('{}'),
		sdks: {},
	})

describe('which provider documents are sources', () => {
	it('drops a document missing what its adapter reads with: no source, no grant', async () => {
		const { payload } = instanceWith([
			plausibleDoc('p1'),
			plausibleDoc('p2', { plausible: { siteId: 'example.com', apiKey: '' } }),
		])
		const registry = registryOf(payload)
		const { registry: adapters, grants } = await registry.resolve({ payload, scope: 'tenant-a' })
		expect(adapters.all().map((adapter) => adapter.id)).toEqual(['native', 'plausible:p1'])
		expect([...grants.keys()]).toEqual(['plausible:p1'])
		expect(await registry.granted?.('tenant-a', 'plausible:p1')).toBe(true)
		expect(await registry.granted?.('tenant-a', 'plausible:p2')).toBe(false)
		await registry.close()
	})

	it('never reads a document of a type the install does not serve', async () => {
		const { payload, documentFind } = instanceWith([
			plausibleDoc('p1'),
			{ id: 'n1', provider: 'native', enabled: true, updatedAt: AT, scope: 'tenant-a' },
		])
		const registry = registryOf(payload, ['umami', 'posthog'])
		const { grants } = await registry.resolve({ payload, scope: 'tenant-a' })
		expect(grants.size).toBe(0)
		expect(documentFind).not.toHaveBeenCalled()
		expect(await registry.granted?.('tenant-a', 'native')).toBe(false)
		expect(await registry.granted?.('tenant-a', 'plausible:p1')).toBe(false)
		await registry.close()
	})

	it('answers granted from the registry it built, decrypting each document once', async () => {
		const { payload, documentFind } = instanceWith([plausibleDoc('p1')])
		const registry = registryOf(payload)
		expect(await registry.granted?.('tenant-a', 'plausible:p1')).toBe(true)
		expect(await registry.granted?.('tenant-a', 'plausible:p1')).toBe(true)
		await registry.resolve({ payload, scope: 'tenant-a' })
		expect(documentFind).toHaveBeenCalledTimes(1)
		await registry.close()
	})
})

describe('a scope’s default grant', () => {
	it('is the adapter of the enabled, available document flagged the default', async () => {
		const { payload } = instanceWith([
			plausibleDoc('p1'),
			plausibleDoc('p2', { isDefault: true }),
			{ id: 'n1', provider: 'native', enabled: true, updatedAt: AT, scope: 'tenant-a' },
		])
		const registry = registryOf(payload)
		expect((await registry.resolve({ payload, scope: 'tenant-a' })).defaultGrant).toBe(
			'plausible:p2'
		)
		await registry.close()
	})

	it('is the native adapter for a flagged native document', async () => {
		const { payload } = instanceWith([
			plausibleDoc('p1'),
			{
				id: 'n1',
				provider: 'native',
				enabled: true,
				isDefault: true,
				updatedAt: AT,
				scope: 'tenant-a',
			},
		])
		const registry = registryOf(payload)
		expect((await registry.resolve({ payload, scope: 'tenant-a' })).defaultGrant).toBe('native')
		await registry.close()
	})

	it('is absent while the flagged document is disabled or lacks its credentials', async () => {
		for (const flagged of [
			plausibleDoc('p2', { isDefault: true, enabled: false }),
			plausibleDoc('p2', { isDefault: true, plausible: { siteId: 'example.com' } }),
		]) {
			const { payload } = instanceWith([plausibleDoc('p1'), flagged])
			const registry = registryOf(payload)
			const resolved = await registry.resolve({ payload, scope: 'tenant-a' })
			expect(resolved.defaultGrant).toBeUndefined()
			expect(resolved.grants.has('plausible:p1')).toBe(true)
			await registry.close()
		}
	})
})
