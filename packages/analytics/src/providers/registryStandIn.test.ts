import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../core/registry'
import { classifyError } from '../surfacing/classifyError'
import { memoryAdapter } from '../testing/memoryAdapter'
import { resolveHostPolicy } from './hosts'
import { createProviderRegistry, FAILED_DOCUMENT_RETRY_MS } from './registry'

const decrypt = vi.fn(async (): Promise<unknown> => 'plain-key')

vi.mock('../plugin/encrypted', () => ({
	loadEncrypted: async () => ({
		decryptFieldValue: decrypt,
		withRawEncrypted: async <T>(_req: unknown, work: () => Promise<T>): Promise<T> => work(),
	}),
}))

vi.mock('payload', async (importOriginal) => ({
	...(await importOriginal<typeof import('payload')>()),
	createLocalReq: async () => ({}),
}))

const AT = '2026-10-07T12:00:00.000Z'

const document = {
	id: 'p1',
	name: 'Tenant site',
	provider: 'plausible',
	enabled: true,
	updatedAt: AT,
	scope: 'tenant-a',
	plausible: { siteId: 'example.com', apiKey: 'ciphertext', revenueCurrency: 'EUR' },
}

const instance = () => {
	const warn = vi.fn()
	const documentFind = vi.fn(async () => ({ docs: [structuredClone(document)] }))
	const payload = {
		collections: { 'analytics-providers': {} },
		db: {
			find: async () => ({
				docs: [
					{ id: 'p1', updatedAt: AT, enabled: true, provider: 'plausible', scope: 'tenant-a' },
				],
			}),
			defaultIDType: 'text',
		},
		find: documentFind,
		logger: { warn },
	} as unknown as Payload
	return { payload, documentFind, warn }
}

const native = { ...memoryAdapter(), id: 'native' }

describe('a provider document that cannot be read', () => {
	it('stands in as a failing source for a minute, then is read again', async () => {
		let at = 0
		const { payload, documentFind, warn } = instance()
		const registry = createProviderRegistry({
			payload,
			plan: { kind: 'collection', slug: 'analytics-providers', scopeField: 'scope' },
			base: { adapters: [native] },
			registry: createRegistry([native]),
			narrow: (scoped) => scoped,
			hosts: resolveHostPolicy(undefined),
			fetch: undefined,
			sdks: {},
			now: () => at,
		})
		decrypt.mockRejectedValueOnce(
			Object.assign(new Error('the key that sealed it is gone'), { name: 'DecryptFailedError' })
		)
		const first = await registry.resolve({ payload, scope: 'tenant-a' })
		const standIn = first.registry.get('plausible:p1')
		expect(standIn.label).toBe('Tenant site')
		expect(standIn.capabilities.metrics.has('revenue')).toBe(true)
		expect(standIn.capture).toBeUndefined()
		const failure = await standIn
			.query({ metrics: ['pageviews'], dateRange: { start: new Date(0), end: new Date(1) } }, {})
			.then(
				() => null,
				(err: unknown) => classifyError(err)
			)
		expect(failure).toEqual({ kind: 'source_misconfigured' })
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not be read'))

		at += FAILED_DOCUMENT_RETRY_MS - 1
		expect((await registry.resolve({ payload, scope: 'tenant-a' })).registry).toBe(first.registry)
		expect(documentFind).toHaveBeenCalledTimes(1)

		at += 1
		const second = await registry.resolve({ payload, scope: 'tenant-a' })
		expect(documentFind).toHaveBeenCalledTimes(2)
		const rebuilt = second.registry.get('plausible:p1')
		expect(rebuilt).not.toBe(standIn)
		expect(rebuilt.isConfigured()).toBe(true)
		at += FAILED_DOCUMENT_RETRY_MS
		await registry.resolve({ payload, scope: 'tenant-a' })
		expect(documentFind).toHaveBeenCalledTimes(2)
		await registry.close()
	})
})
