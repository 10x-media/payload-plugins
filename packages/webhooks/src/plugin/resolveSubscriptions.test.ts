import { describe, expect, it } from 'vitest'
import { SECRET_MASK, SECRET_PREFIX } from '../constants'
import { generateSecret } from '../secrets/format'
import { fromCodeSubscription, fromCollectionRow, matchSubscriptions } from './resolveSubscriptions'

describe('fromCollectionRow', () => {
	const secret = generateSecret()

	it('normalizes ids, headers, and defaults enabled to true', () => {
		const r = fromCollectionRow({
			id: 7,
			url: 'https://x',
			events: ['posts.created'],
			secret,
			headers: [
				{ key: 'X-A', value: '1' },
				{ key: '', value: 'skip' },
			],
			enabled: null,
		})
		expect(r).toEqual({
			id: '7',
			source: 'collection',
			url: 'https://x',
			events: ['posts.created'],
			secrets: [secret],
			secretUnusable: false,
			retiredSecretUnusable: false,
			headers: { 'X-A': '1' },
			enabled: true,
		})
	})

	it('drops a masked secret instead of signing with the placeholder', () => {
		const r = fromCollectionRow({ id: 1, url: 'https://x', secret: SECRET_MASK })
		expect(r.secrets).toEqual([])
	})

	it('drops a null secret', () => {
		expect(fromCollectionRow({ id: 1, url: 'https://x', secret: null }).secrets).toEqual([])
		expect(fromCollectionRow({ id: 1, url: 'https://x' }).secrets).toEqual([])
	})
})

describe('fromCodeSubscription', () => {
	it('defaults enabled to true', () => {
		expect(fromCodeSubscription({ id: 'c', url: 'https://y', events: [] }).enabled).toBe(true)
		expect(
			fromCodeSubscription({ id: 'c', url: 'https://y', events: [], enabled: false }).enabled
		).toBe(false)
	})

	it('normalizes a bare base64 secret onto the whsec_ form', () => {
		const bare = generateSecret().slice(SECRET_PREFIX.length)
		expect(fromCodeSubscription({ id: 'c', url: 'u', events: [], secret: bare }).secrets).toEqual([
			`${SECRET_PREFIX}${bare}`,
		])
	})

	it('yields no secrets when none is configured', () => {
		expect(fromCodeSubscription({ id: 'c', url: 'u', events: [] }).secrets).toEqual([])
	})
})

describe('matchSubscriptions', () => {
	const subs = [
		fromCodeSubscription({ id: 'a', url: 'u', events: ['posts.created'] }),
		fromCodeSubscription({ id: 'b', url: 'u', events: ['posts.updated'] }),
		fromCodeSubscription({ id: 'c', url: 'u', events: ['posts.created'], enabled: false }),
	]
	it('returns enabled subs listening for the event', () => {
		expect(matchSubscriptions(subs, 'posts.created').map((s) => s.id)).toEqual(['a'])
	})
})
