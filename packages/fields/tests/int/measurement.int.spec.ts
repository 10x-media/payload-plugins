import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import {
	MEASUREMENT_PREFERENCE_KEY,
	measurementField,
	presets,
} from '../../src/exports/measurement'
import { fields } from '../../src/index'

const users: CollectionConfig = {
	slug: 'users',
	auth: true,
	fields: [],
}

const athletes: CollectionConfig = {
	slug: 'athletes',
	fields: [
		{ name: 'title', type: 'text' },
		measurementField({ ...presets.bodyWeight }),
		measurementField({ ...presets.personHeight }),
		measurementField({ ...presets.distance, max: 100, min: 1, name: 'bounded' }),
		measurementField({
			name: 'cutout',
			preferenceKey: 'cutout',
			storageUnit: 'mm',
			units: ['in', 'ft-in'],
		}),
		measurementField({
			name: 'shippingWeight',
			preferenceKey: 'shippingWeight',
			storageUnit: 'g',
			units: ['g', 'kg'],
			precision: { storage: 0 },
		}),
	],
}

describeForDb('measurement field integration', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [users, athletes],
			db,
			plugin: fields({ measurement: { defaultUnits: { bodyWeight: 'kg' } } }),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores plain numbers rounded to storage precision', async () => {
		const doc = await booted.payload.create({
			collection: 'athletes',
			data: { height: 180.34, title: 'a', weight: 81.6466266 },
		})
		expect(doc.weight).toBe(81.646627)
		expect(doc.height).toBe(180.34)
	})

	it('enforces min/max in storage units via native number validation', async () => {
		await expect(
			booted.payload.create({ collection: 'athletes', data: { bounded: 200, title: 'b' } })
		).rejects.toThrow()
	})

	it('rejects non-numeric input via native validation', async () => {
		await expect(
			booted.payload.create({
				collection: 'athletes',
				data: { title: 'c', weight: 'heavy' as never },
			})
		).rejects.toThrow()
	})

	it('rejects NaN, which native validation would let through to the column', async () => {
		await expect(
			booted.payload.create({
				collection: 'athletes',
				data: { title: 'nan', weight: Number.NaN },
			})
		).rejects.toThrow()
	})

	it('sorts and filters on the canonical number', async () => {
		// Weights above 200 are unique to this test, so filter and descending
		// order stay deterministic whatever else the suite created.
		await booted.payload.create({ collection: 'athletes', data: { title: 'silver', weight: 250 } })
		await booted.payload.create({ collection: 'athletes', data: { title: 'gold', weight: 300 } })
		const result = await booted.payload.find({
			collection: 'athletes',
			sort: '-weight',
			where: { weight: { greater_than: 200 } },
		})
		expect(result.docs.map((doc) => doc.title)).toEqual(['gold', 'silver'])
	})

	it('round-trips a preference doc under the plugin key', async () => {
		const user = await booted.payload.create({
			collection: 'users',
			data: { email: 'units@test.dev', password: 'password' },
		})
		await booted.payload.create({
			collection: 'payload-preferences',
			data: {
				key: MEASUREMENT_PREFERENCE_KEY,
				user: { relationTo: 'users', value: user.id },
				value: { bodyWeight: 'lb' },
			},
			user,
		})
		const found = await booted.payload.find({
			collection: 'payload-preferences',
			where: {
				and: [
					{ key: { equals: MEASUREMENT_PREFERENCE_KEY } },
					{ 'user.value': { equals: user.id } },
				],
			},
		})
		expect(found.docs[0]?.value).toEqual({ bodyWeight: 'lb' })
	})

	it('rounds a write to a field-declared storage granularity through the real API', async () => {
		const doc = await booted.payload.create({
			collection: 'athletes',
			data: { shippingWeight: 3400.7, title: 'storage-zero' },
		})
		expect(doc.shippingWeight).toBe(3401)
	})

	it('stores a free-form field canonically in its declared storage unit', async () => {
		const doc = await booted.payload.create({
			collection: 'athletes',
			data: { cutout: 500.12345678, title: 'cutout-storage' },
		})
		expect(doc.cutout).toBe(500.123457)
	})

	it('round-trips a free-form preferenceKey bucket independent of bodyWeight', async () => {
		const user = await booted.payload.create({
			collection: 'users',
			data: { email: 'cutout-units@test.dev', password: 'password' },
		})
		await booted.payload.create({
			collection: 'payload-preferences',
			data: {
				key: MEASUREMENT_PREFERENCE_KEY,
				user: { relationTo: 'users', value: user.id },
				value: { bodyWeight: 'kg', cutout: 'in' },
			},
			user,
		})
		const found = await booted.payload.find({
			collection: 'payload-preferences',
			where: {
				and: [
					{ key: { equals: MEASUREMENT_PREFERENCE_KEY } },
					{ 'user.value': { equals: user.id } },
				],
			},
		})
		expect(found.docs[0]?.value).toEqual({ bodyWeight: 'kg', cutout: 'in' })
	})
})
