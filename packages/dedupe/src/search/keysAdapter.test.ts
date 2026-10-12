import { describe, expect, it } from 'vitest'

import { bucketPage } from './keysAdapter'

describe('bucketPage', () => {
	it('groups consecutive rows by key and ends when the page is not full', () => {
		const page = bucketPage(
			[
				{ doc: '1', key: 'a' },
				{ doc: '2', key: 'a' },
				{ doc: '3', key: 'b' },
			],
			10
		)
		expect(page).toEqual({
			buckets: [
				{ key: 'a', ids: ['1', '2'] },
				{ key: 'b', ids: ['3'] },
			],
			nextCursor: null,
			oversized: [],
		})
	})

	it('leaves the last group for the next page when the page overflowed', () => {
		const page = bucketPage(
			[
				{ doc: '1', key: 'a' },
				{ doc: '2', key: 'a' },
				{ doc: '3', key: 'b' },
				{ doc: '4', key: 'b' },
			],
			3
		)
		expect(page).toEqual({
			buckets: [{ key: 'a', ids: ['1', '2'] }],
			nextCursor: 'a',
			oversized: [],
		})
	})

	it('skips a single key that fills the whole page', () => {
		const page = bucketPage(
			[
				{ doc: '1', key: 'a' },
				{ doc: '2', key: 'a' },
				{ doc: '3', key: 'a' },
			],
			2
		)
		expect(page).toEqual({ buckets: [], nextCursor: 'a', oversized: ['a'] })
	})
})
