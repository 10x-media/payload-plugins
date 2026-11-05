import type { PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { requestMemo, userKey } from './requestMemo'

const request = (user?: { id: string; collection: string }): PayloadRequest =>
	({ ...(user ? { user } : {}) }) as unknown as PayloadRequest

describe('requestMemo', () => {
	it('computes an answer once per request however many reads ask', async () => {
		const memo = requestMemo<string>('test/once')
		const owner = {}
		const compute = vi.fn(() => Promise.resolve('Europe/Berlin'))
		const req = request()
		const answers = await Promise.all([
			memo(req, { owner, key: 'tz', compute }),
			memo(req, { owner, key: 'tz', compute }),
			memo(req, { owner, key: 'tz', compute }),
		])
		expect(answers).toEqual(['Europe/Berlin', 'Europe/Berlin', 'Europe/Berlin'])
		expect(compute).toHaveBeenCalledTimes(1)
	})

	it('asks again on another request, for another key and for another owner', async () => {
		const memo = requestMemo<number>('test/apart')
		const owner = {}
		let calls = 0
		const compute = () => ++calls
		const req = request()
		await memo(req, { owner, key: 'a', compute })
		await memo(request(), { owner, key: 'a', compute })
		await memo(req, { owner, key: 'b', compute })
		await memo(req, { owner: {}, key: 'a', compute })
		expect(calls).toBe(4)
	})

	it('asks again once a Local API call swaps the request’s user', async () => {
		const memo = requestMemo<string>('test/user')
		const owner = {}
		const req = request({ id: '1', collection: 'users' })
		const compute = vi.fn(() => userKey(req))
		expect(await memo(req, { owner, key: 'scope', compute })).toBe('users:1')
		Reflect.set(req, 'user', { id: '2', collection: 'users' })
		expect(await memo(req, { owner, key: 'scope', compute })).toBe('users:2')
		expect(compute).toHaveBeenCalledTimes(2)
	})

	it('rejects every caller alike when the answer throws, without asking twice', async () => {
		const memo = requestMemo<string>('test/reject')
		const owner = {}
		const compute = vi.fn((): string => {
			throw new Error('resolver down')
		})
		const req = request()
		await expect(memo(req, { owner, key: 'k', compute })).rejects.toThrow('resolver down')
		await expect(memo(req, { owner, key: 'k', compute })).rejects.toThrow('resolver down')
		expect(compute).toHaveBeenCalledTimes(1)
	})

	it('shares one answer between two copies of the memo, as the package’s bundles do', async () => {
		const first = requestMemo<string>('test/bundles')
		const second = requestMemo<string>('test/bundles')
		const owner = {}
		const req = request()
		await first(req, { owner, key: 'k', compute: () => 'from the first' })
		expect(await second(req, { owner, key: 'k', compute: () => 'from the second' })).toBe(
			'from the first'
		)
	})
})
