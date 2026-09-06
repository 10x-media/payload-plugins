import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { resolveScopeList } from './scopeList'

const payload = {} as Payload

describe('resolveScopeList', () => {
	it('returns just [null] when no scopes resolver is configured', async () => {
		expect(await resolveScopeList(undefined, payload)).toEqual([null])
	})

	it('prepends null to the resolved tenant scopes', async () => {
		const scopes = () => ['t1', 't2']
		expect(await resolveScopeList(scopes, payload)).toEqual([null, 't1', 't2'])
	})

	it('awaits an async resolver', async () => {
		const scopes = async () => ['t1']
		expect(await resolveScopeList(scopes, payload)).toEqual([null, 't1'])
	})

	it('dedupes repeated scopes and folds an empty string into null', async () => {
		const scopes = () => ['t1', 't1', '', 't2']
		expect(await resolveScopeList(scopes, payload)).toEqual([null, 't1', 't2'])
	})

	it('degrades to [null] and warns when the resolver throws', async () => {
		const warn = vi.fn()
		const scopes = () => {
			throw new Error('boom')
		}
		const list = await resolveScopeList(scopes, { logger: { warn } } as unknown as Payload)
		expect(list).toEqual([null])
		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toMatch(/scopes/i)
	})

	it('degrades to [null] and warns when the resolver rejects', async () => {
		const warn = vi.fn()
		const scopes = async () => {
			throw new Error('boom')
		}
		const list = await resolveScopeList(scopes, { logger: { warn } } as unknown as Payload)
		expect(list).toEqual([null])
		expect(warn).toHaveBeenCalledTimes(1)
	})
})
