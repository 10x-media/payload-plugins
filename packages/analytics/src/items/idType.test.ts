import type { Payload } from 'payload'
import { describe, expect, it } from 'vitest'
import { itemIdTypeOf, itemIdTypes } from './collectionIdType'
import { fitsIdType } from './idType'

describe('fitsIdType', () => {
	it('takes a Mongo ObjectId as the database writes it, and nothing a cast would refuse', () => {
		expect(fitsIdType('65f0c0ffee0123456789abcd', 'objectId')).toBe(true)
		for (const id of [
			'x',
			'42',
			'aaaaaaaaaaaa',
			'65F0C0FFEE0123456789ABCD',
			'65f0c0ffee0123456789abc',
		]) {
			expect(fitsIdType(id, 'objectId'), id).toBe(false)
		}
	})

	it('takes a Postgres serial id within the integer column, written once', () => {
		for (const id of ['1', '42', '2147483647', '-7']) {
			expect(fitsIdType(id, 'serial'), id).toBe(true)
		}
		for (const id of ['x', '1.5', '01', '1e3', '-0', ' 1', '2147483648', 'NaN', 'Infinity']) {
			expect(fitsIdType(id, 'serial'), id).toBe(false)
		}
	})

	it('takes any finite number for a numeric id field, in its one spelling', () => {
		for (const id of ['1', '1.5', '-2', '2147483648']) {
			expect(fitsIdType(id, 'number'), id).toBe(true)
		}
		for (const id of ['x', '1.50', '1e21', 'NaN', 'Infinity', '']) {
			expect(fitsIdType(id, 'number'), id).toBe(false)
		}
	})

	it('takes a uuid as Postgres hands it back, lowercase and hyphenated', () => {
		expect(fitsIdType('0b4f6a9e-3c1d-4e7a-9b2f-8d6c5e4a3b21', 'uuid')).toBe(true)
		for (const id of [
			'x',
			'42',
			'0B4F6A9E-3C1D-4E7A-9B2F-8D6C5E4A3B21',
			'0b4f6a9e3c1d4e7a9b2f8d6c5e4a3b21',
			'{0b4f6a9e-3c1d-4e7a-9b2f-8d6c5e4a3b21}',
		]) {
			expect(fitsIdType(id, 'uuid'), id).toBe(false)
		}
	})

	it('takes any id at all for a text id field', () => {
		for (const id of ['x', 'spring sale', 'a:b/c', '42']) {
			expect(fitsIdType(id, 'text'), id).toBe(true)
		}
	})
})

const payloadWith = (args: {
	name: string
	defaultIDType: 'number' | 'text'
	idType?: string
	collections?: Record<string, { customIDType?: 'number' | 'text' }>
}): Payload =>
	({
		db: {
			name: args.name,
			defaultIDType: args.defaultIDType,
			...(args.idType === undefined ? {} : { idType: args.idType }),
		},
		collections: args.collections ?? { offers: {} },
	}) as unknown as Payload

describe('itemIdTypeOf', () => {
	it("reads the database adapter's default when the collection declares no id of its own", () => {
		expect(itemIdTypeOf(payloadWith({ name: 'mongoose', defaultIDType: 'text' }), 'offers')).toBe(
			'objectId'
		)
		expect(
			itemIdTypeOf(
				payloadWith({ name: 'postgres', defaultIDType: 'number', idType: 'serial' }),
				'offers'
			)
		).toBe('serial')
		expect(
			itemIdTypeOf(
				payloadWith({ name: 'postgres', defaultIDType: 'text', idType: 'uuid' }),
				'offers'
			)
		).toBe('uuid')
		expect(
			itemIdTypeOf(
				payloadWith({ name: 'sqlite', defaultIDType: 'text', idType: 'uuidv7' }),
				'offers'
			)
		).toBe('uuid')
		expect(
			itemIdTypeOf(
				payloadWith({ name: 'sqlite', defaultIDType: 'number', idType: 'number' }),
				'offers'
			)
		).toBe('number')
	})

	it('reads a custom id field over the adapter default', () => {
		const payload = payloadWith({
			name: 'mongoose',
			defaultIDType: 'text',
			collections: { offers: { customIDType: 'number' }, banners: { customIDType: 'text' } },
		})
		expect(itemIdTypeOf(payload, 'offers')).toBe('number')
		expect(itemIdTypeOf(payload, 'banners')).toBe('text')
	})

	it('keeps every id for an adapter it does not know', () => {
		expect(itemIdTypeOf(payloadWith({ name: 'custom', defaultIDType: 'text' }), 'offers')).toBe(
			'text'
		)
	})

	it('maps each bound collection to its id type', () => {
		const payload = payloadWith({
			name: 'postgres',
			defaultIDType: 'number',
			idType: 'serial',
			collections: { offers: {}, banners: { customIDType: 'text' } },
		})
		expect([...itemIdTypes(payload, ['offers', 'banners'])]).toEqual([
			['offers', 'serial'],
			['banners', 'text'],
		])
	})
})
