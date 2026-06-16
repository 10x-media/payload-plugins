import { describe, expect, it } from 'vitest'
import { fromCodeSubscription, fromCollectionRow, matchSubscriptions } from './resolveSubscriptions'

describe('fromCollectionRow', () => {
	it('normalizes ids, headers, and defaults enabled to true', () => {
		const r = fromCollectionRow({
			id: 7,
			url: 'https://x',
			events: ['posts.created'],
			secret: 'k',
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
			secret: 'k',
			headers: { 'X-A': '1' },
			enabled: true,
		})
	})
})

describe('fromCodeSubscription', () => {
	it('defaults enabled to true', () => {
		expect(fromCodeSubscription({ id: 'c', url: 'https://y', events: [] }).enabled).toBe(true)
		expect(
			fromCodeSubscription({ id: 'c', url: 'https://y', events: [], enabled: false }).enabled
		).toBe(false)
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
