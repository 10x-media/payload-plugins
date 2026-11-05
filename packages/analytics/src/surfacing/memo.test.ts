import { describe, expect, it } from 'vitest'
import { createMemo, MEMO_CAPACITY } from './memo'

const clock = () => {
	let at = 1_000
	return { now: () => at, advance: (ms: number) => (at += ms) }
}

describe('createMemo', () => {
	it('answers a value for its own time and nothing after', () => {
		const time = clock()
		const memo = createMemo<string>({ now: time.now })
		memo.set('short', 'a', 1_000)
		memo.set('long', 'b', 15_000)
		time.advance(999)
		expect(memo.get('short')).toBe('a')
		time.advance(1)
		expect(memo.get('short')).toBeUndefined()
		expect(memo.get('long')).toBe('b')
		time.advance(14_000)
		expect(memo.get('long')).toBeUndefined()
		expect(memo.size).toBe(0)
	})

	it('drops the least recently used entry once full, counting a get as a use', () => {
		const memo = createMemo<number>({ capacity: 3 })
		memo.set('a', 1, 60_000)
		memo.set('b', 2, 60_000)
		memo.set('c', 3, 60_000)
		expect(memo.get('a')).toBe(1)
		memo.set('d', 4, 60_000)
		expect(memo.size).toBe(3)
		expect(memo.get('b')).toBeUndefined()
		expect([memo.get('a'), memo.get('c'), memo.get('d')]).toEqual([1, 3, 4])
	})

	it('keeps nothing for a time of zero, and forgets what the key held', () => {
		const memo = createMemo<number>()
		memo.set('a', 1, 60_000)
		memo.set('a', 2, 0)
		expect(memo.get('a')).toBeUndefined()
		expect(memo.size).toBe(0)
	})

	it('forgets a key on delete and leaves the others', () => {
		const memo = createMemo<number>()
		memo.set('a', 1, 60_000)
		memo.set('b', 2, 60_000)
		memo.delete('a')
		memo.delete('missing')
		expect(memo.get('a')).toBeUndefined()
		expect(memo.get('b')).toBe(2)
	})

	it(`holds ${MEMO_CAPACITY} entries by default`, () => {
		const memo = createMemo<number>()
		for (let i = 0; i < MEMO_CAPACITY + 20; i++) {
			memo.set(`k${i}`, i, 60_000)
		}
		expect(memo.size).toBe(MEMO_CAPACITY)
		expect(memo.get('k0')).toBeUndefined()
		expect(memo.get(`k${MEMO_CAPACITY + 19}`)).toBe(MEMO_CAPACITY + 19)
	})
})
