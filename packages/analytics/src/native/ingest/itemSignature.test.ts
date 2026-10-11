import { createHmac } from 'node:crypto'
import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { ITEM_ATTRIBUTE, ITEM_NAME_ATTRIBUTE, MAX_ITEM_REF_LENGTH } from '../../goals/constants'
import {
	itemAttributesFor,
	itemRefKey,
	itemRefSignature,
	signItemRef,
	verifiedItemRef,
} from './itemSignature'

const SECRET = 'payload-secret'

/** As much of a Payload instance as signing reads: its secret and how its ids look. */
const fakePayload = (db: Record<string, unknown> = { name: 'mongoose' }): Payload =>
	({ secret: SECRET, collections: { offers: {} }, db }) as unknown as Payload

describe('item ref keys and signatures', () => {
	it('derives the key from the instance secret, for this one use', () => {
		const expected = createHmac('sha256', SECRET).update('analytics:item-ref:v1').digest()
		expect(itemRefKey(SECRET).equals(expected)).toBe(true)
		expect(itemRefKey(SECRET)).toBe(itemRefKey(SECRET))
		expect(itemRefKey('other').equals(expected)).toBe(false)
	})

	it('signs with 72 bits of the ref’s HMAC, base64url', () => {
		const key = itemRefKey(SECRET)
		const expected = createHmac('sha256', key).update('offers:12').digest('base64url').slice(0, 12)
		expect(itemRefSignature(key, 'offers:12')).toBe(expected)
		expect(expected).toMatch(/^[A-Za-z0-9_-]{12}$/)
		expect(itemRefSignature(key, 'offers:13')).not.toBe(expected)
	})
})

describe('verifiedItemRef', () => {
	const key = itemRefKey(SECRET)
	const required = { mode: 'required' as const, key }
	const optional = { mode: 'optional' as const, key }
	const signed = (ref: string) => `${ref}@${itemRefSignature(key, ref)}`

	it('keeps a ref the server signed, as the bare ref', () => {
		expect(verifiedItemRef(signed('offers:12'), required, false)).toBe('offers:12')
	})

	it('drops a ref signed for another ref or with another key', () => {
		expect(
			verifiedItemRef(`offers:13@${itemRefSignature(key, 'offers:12')}`, required, false)
		).toBeUndefined()
		const otherKey = itemRefKey('another-secret')
		expect(
			verifiedItemRef(`offers:12@${itemRefSignature(otherKey, 'offers:12')}`, required, false)
		).toBeUndefined()
	})

	it('drops a signature of any other length or alphabet', () => {
		const good = signed('offers:12')
		expect(verifiedItemRef(`${good}x`, required, false)).toBeUndefined()
		expect(verifiedItemRef(good.slice(0, -1), required, false)).toBeUndefined()
		expect(verifiedItemRef('offers:12@', required, false)).toBeUndefined()
		expect(verifiedItemRef('offers:12@++++////====', required, false)).toBeUndefined()
	})

	it('drops an unsigned ref from a page unless signatures are optional', () => {
		expect(verifiedItemRef('offers:12', required, false)).toBeUndefined()
		expect(verifiedItemRef('offers:12', optional, false)).toBe('offers:12')
		expect(verifiedItemRef('offers:12', undefined, false)).toBeUndefined()
	})

	it('trusts server code’s unsigned refs, and still checks a signature it relays', () => {
		expect(verifiedItemRef('offers:12', required, true)).toBe('offers:12')
		expect(verifiedItemRef('offers:12', undefined, true)).toBe('offers:12')
		expect(
			verifiedItemRef(`offers:13@${itemRefSignature(key, 'offers:12')}`, required, true)
		).toBeUndefined()
		expect(verifiedItemRef(signed('offers:12'), undefined, true)).toBeUndefined()
	})

	it('drops what is not an item value at all', () => {
		expect(verifiedItemRef(12, required, true)).toBeUndefined()
		expect(verifiedItemRef('offers', optional, false)).toBeUndefined()
		expect(verifiedItemRef('offers:a b', optional, false)).toBeUndefined()
	})
})

describe('signItemRef', () => {
	it('writes the ref and the signature ingest checks', () => {
		const payload = fakePayload()
		const value = signItemRef(payload, 'offers', '65f0c0ffee0123456789abcd')
		expect(value).toMatch(/^offers:65f0c0ffee0123456789abcd@[A-Za-z0-9_-]{12}$/)
		expect(verifiedItemRef(value, { mode: 'required', key: itemRefKey(SECRET) }, false)).toBe(
			'offers:65f0c0ffee0123456789abcd'
		)
	})

	it('encodes an @ inside the id, so only the signature follows the last one', () => {
		const payload = fakePayload({ name: 'postgres', defaultIDType: 'text' })
		const value = signItemRef(payload, 'offers', 'a@b')
		expect(value?.startsWith('offers:a%40b@')).toBe(true)
		expect(verifiedItemRef(value, { mode: 'required', key: itemRefKey(SECRET) }, false)).toBe(
			'offers:a%40b'
		)
	})

	it('signs nothing without an id, for an id the collection could not hold, or past the cap', () => {
		const payload = fakePayload()
		expect(signItemRef(payload, 'offers', undefined)).toBeUndefined()
		expect(signItemRef(payload, 'offers', '')).toBeUndefined()
		expect(signItemRef(payload, ' ', '65f0c0ffee0123456789abcd')).toBeUndefined()
		expect(signItemRef(payload, 'offers', 'not-an-object-id')).toBeUndefined()
		const text = fakePayload({ name: 'postgres', defaultIDType: 'text' })
		expect(signItemRef(text, 'offers', 'x'.repeat(MAX_ITEM_REF_LENGTH))).toBeUndefined()
	})

	it('signs a numeric id as the database hands it back', () => {
		const serial = fakePayload({ name: 'postgres', defaultIDType: 'number', idType: 'serial' })
		expect(signItemRef(serial, 'offers', 12)?.startsWith('offers:12@')).toBe(true)
		expect(signItemRef(serial, 'offers', '012')).toBeUndefined()
	})
})

describe('itemAttributesFor', () => {
	it('marks an element with the signed ref and the name for vendor slots', () => {
		const payload = fakePayload()
		const attributes = itemAttributesFor(payload, {
			collection: 'offers',
			id: '65f0c0ffee0123456789abcd',
			name: ' Spring sale ',
		})
		expect(attributes[ITEM_ATTRIBUTE]).toBe(
			signItemRef(payload, 'offers', '65f0c0ffee0123456789abcd')
		)
		expect(attributes[ITEM_NAME_ATTRIBUTE]).toBe('Spring sale')
	})

	it('spreads to nothing for an item it cannot sign', () => {
		expect(itemAttributesFor(fakePayload(), { collection: 'offers', id: null })).toEqual({})
	})
})
