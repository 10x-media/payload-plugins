import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { dedupeKeyFor } from '../ingest/revenue'
import {
	aggregateId,
	createUlidFactory,
	isOrderHitId,
	orderHitId,
	orderTwinOf,
	SERVER_ORDER_PREFIX,
	serverTwinOf,
	ULID_LENGTH,
	ulid,
	ulidTime,
	WIRE_ORDER_PREFIX,
	wireTwinOf,
} from './ids'

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]+$/

/** A random source handing out the given bytes, ten at a time. */
const fixedRandom =
	(...fills: number[]) =>
	(size: number): Uint8Array => {
		const fill = fills.shift() ?? 0
		return new Uint8Array(size).fill(fill)
	}

describe('ulid', () => {
	it('writes 26 characters of Crockford base32 carrying the time it was given', () => {
		const at = Date.UTC(2026, 9, 5, 12, 0, 0, 123)
		const id = ulid(at)
		expect(id).toHaveLength(ULID_LENGTH)
		expect(id).toMatch(CROCKFORD)
		expect(ulidTime(id)).toBe(at)
		expect(ulidTime(ulid(new Date(at)))).toBe(at)
	})

	it('writes the time as the spec does: zero is all zeros, the last millisecond 7ZZZZZZZZZ', () => {
		const make = createUlidFactory(fixedRandom(0, 0))
		expect(make(0)).toBe('0'.repeat(26))
		expect(make(2 ** 48 - 1).slice(0, 10)).toBe('7ZZZZZZZZZ')
	})

	it('increments the random part within one millisecond, so ids sort in the order they were made', () => {
		const make = createUlidFactory()
		const at = Date.UTC(2026, 9, 5)
		const ids = Array.from({ length: 1000 }, () => make(at))
		expect(new Set(ids).size).toBe(1000)
		expect([...ids].sort()).toEqual(ids)
		expect(ids.every((id) => ulidTime(id) === at)).toBe(true)
	})

	it('carries into the next digit, and draws fresh randomness for a new millisecond', () => {
		const make = createUlidFactory(fixedRandom(0, 0))
		const first = make(1000)
		const second = make(1000)
		expect(first.slice(10)).toBe('0'.repeat(16))
		expect(second.slice(10)).toBe(`${'0'.repeat(15)}1`)
		expect(make(1001).slice(10)).toBe('0'.repeat(16))
	})

	it('sorts by time first, whatever the random parts', () => {
		const make = createUlidFactory(fixedRandom(0xff, 0x00))
		const earlier = make(5000)
		const later = make(5001)
		expect(earlier < later).toBe(true)
	})

	it('refuses to wrap around when a millisecond runs out of ids', () => {
		const make = createUlidFactory(fixedRandom(0xff))
		make(7)
		expect(() => make(7)).toThrow(RangeError)
	})

	it('refuses a time a ULID cannot hold', () => {
		const make = createUlidFactory()
		expect(() => make(-1)).toThrow(RangeError)
		expect(() => make(2 ** 48)).toThrow(RangeError)
		expect(() => make(1.5)).toThrow(RangeError)
		expect(() => make(new Date(Number.NaN))).toThrow(RangeError)
	})

	it('reads no time out of something that is not a ULID', () => {
		expect(ulidTime('short')).toBeNull()
		expect(ulidTime(`${'0'.repeat(25)}U`)).toBeNull()
		expect(ulidTime(`8${'0'.repeat(25)}`)).toBeNull()
	})
})

describe('orderHitId', () => {
	it('is the dedupe key behind an o, so a retried order lands on the same row', () => {
		expect(orderHitId('s.abc')).toBe('os.abc')
		expect(orderHitId('w.abc')).toBe('ow.abc')
	})

	it('can never be mistaken for a ULID, nor a ULID for it', () => {
		expect(isOrderHitId(orderHitId('s.abc'))).toBe(true)
		expect(isOrderHitId(ulid(Date.UTC(2026, 9, 5)))).toBe(false)
		expect(isOrderHitId(ulid(2 ** 48 - 1))).toBe(false)
	})
})

describe('order twins', () => {
	const sale = { goal: 'purchase', orderId: 'ord_1', tenant: 'shop' }
	const wire = orderHitId(dedupeKeyFor({ ...sale, origin: 'wire' }))
	const server = orderHitId(dedupeKeyFor({ ...sale, origin: 'server' }))

	it('pairs the browser and the server record of one sale, and nothing else', () => {
		expect([WIRE_ORDER_PREFIX, SERVER_ORDER_PREFIX]).toEqual(['ow.', 'os.'])
		expect(serverTwinOf(wire)).toBe(server)
		expect(wireTwinOf(server)).toBe(wire)
		expect(serverTwinOf(server)).toBeUndefined()
		expect(wireTwinOf(wire)).toBeUndefined()
		expect(serverTwinOf(ulid(Date.UTC(2026, 9, 7)))).toBeUndefined()
	})

	it('names the other record of an order from either side, and nothing for any other hit', () => {
		expect(orderTwinOf(wire)).toBe(server)
		expect(orderTwinOf(server)).toBe(wire)
		expect(orderTwinOf('01J9ZQ0000000000000000000A')).toBeUndefined()
	})
})

describe('aggregateId', () => {
	const key = {
		scope: 'alpha',
		day: 20261005,
		hostname: 'a.example.com',
		dim: 'page',
		value: '/pricing',
		dim2: '',
		value2: '',
	}

	it('is 22 base64url characters of the key hashed as JSON', () => {
		const expected = createHash('sha256')
			.update(JSON.stringify(['alpha', 20261005, 'a.example.com', 'page', '/pricing', '', '']))
			.digest('base64url')
			.slice(0, 22)
		expect(aggregateId(key)).toBe(expected)
		expect(aggregateId(key)).toMatch(/^[A-Za-z0-9_-]{22}$/)
	})

	it('is the same for the same key and different for any other', () => {
		expect(aggregateId({ ...key })).toBe(aggregateId(key))
		for (const changed of [
			{ scope: '' },
			{ day: 20261006 },
			{ hostname: 'b.example.com' },
			{ dim: 'event' },
			{ value: '/' },
			{ dim2: 'channel' },
			{ value2: 'direct' },
		]) {
			expect(aggregateId({ ...key, ...changed })).not.toBe(aggregateId(key))
		}
	})

	it('keeps the parts apart, so no value can be written to read as two', () => {
		expect(aggregateId({ ...key, value: 'a', dim2: 'b' })).not.toBe(
			aggregateId({ ...key, value: 'ab', dim2: '' })
		)
	})
})
