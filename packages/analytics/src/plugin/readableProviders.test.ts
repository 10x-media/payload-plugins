import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../core/registry'
import { memoryAdapter } from '../testing/memoryAdapter'
import { readableProviderDocIds } from './readableProviders'
import type { AnalyticsRuntime } from './runtime'

const runtimeWith = (
	providersCollection?: AnalyticsRuntime['providersCollection']
): AnalyticsRuntime => ({
	registry: createRegistry([memoryAdapter()]),
	configAdapterIds: new Set(),
	bindings: {},
	engine: { read: async (adapter, query) => adapter.query(query, {}) },
	ttl: {},
	comparison: true,
	...(providersCollection ? { providersCollection } : {}),
})

type FindArgs = { user?: { id: number } | null; overrideAccess?: boolean }

/** A Local API request whose finds answer the document the asking user may read. */
const requestFor = (userId: number) => {
	const find = vi.fn(async (args: FindArgs) => ({
		docs: [{ id: `doc-of-${args.user?.id ?? 'nobody'}` }],
	}))
	const req = {
		payload: { find, logger: { warn: () => undefined } },
		user: { id: userId, collection: 'users' },
	} as unknown as PayloadRequest
	const swapUser = (id: number) => {
		Object.assign(req, { user: { id, collection: 'users' } })
	}
	return { req, find, swapUser }
}

describe('readableProviderDocIds', () => {
	it('is null on an install without the providers collection', () => {
		expect(readableProviderDocIds(runtimeWith(), requestFor(1).req, 'alpha')).toBeNull()
	})

	it('asks once per scope and user, and again once a reused request carries another user', async () => {
		const runtime = runtimeWith({ slug: 'analytics-providers', scopeField: 'scope' })
		const { req, find, swapUser } = requestFor(1)
		await expect(readableProviderDocIds(runtime, req, 'alpha')).resolves.toEqual(
			new Set(['doc-of-1'])
		)
		await expect(readableProviderDocIds(runtime, req, 'alpha')).resolves.toEqual(
			new Set(['doc-of-1'])
		)
		expect(find).toHaveBeenCalledTimes(1)
		swapUser(2)
		await expect(readableProviderDocIds(runtime, req, 'alpha')).resolves.toEqual(
			new Set(['doc-of-2'])
		)
		expect(find).toHaveBeenCalledTimes(2)
	})

	it("asks sourceAccess again for the swapped-in user rather than reusing the first one's answer", async () => {
		const sourceAccess = vi.fn(({ req }: { req: PayloadRequest }) => req.user?.id === 1)
		const runtime = runtimeWith({ slug: 'analytics-providers', scopeField: 'scope', sourceAccess })
		const { req, swapUser } = requestFor(1)
		await expect(readableProviderDocIds(runtime, req, 'alpha')).resolves.toEqual(
			new Set(['doc-of-nobody'])
		)
		swapUser(2)
		await expect(readableProviderDocIds(runtime, req, 'alpha')).resolves.toEqual(new Set())
		expect(sourceAccess).toHaveBeenCalledTimes(2)
	})
})
