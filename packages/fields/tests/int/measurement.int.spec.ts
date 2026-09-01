import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { MEASUREMENT_PREFERENCE_KEY, measurementField } from '../../src/exports/measurement'
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
		measurementField({ usage: 'bodyWeight' }),
		measurementField({ name: 'height', storageUnit: 'cm', usage: 'personHeight' }),
		measurementField({ max: 100, min: 1, name: 'bounded', usage: 'distance' }),
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

	it('sorts and filters on the canonical number', async () => {
		await booted.payload.create({ collection: 'athletes', data: { title: 'light', weight: 60 } })
		await booted.payload.create({ collection: 'athletes', data: { title: 'heavy', weight: 100 } })
		const result = await booted.payload.find({
			collection: 'athletes',
			sort: '-weight',
			where: { weight: { greater_than: 90 } },
		})
		expect(result.docs.map((doc) => doc.title)).toEqual(['heavy'])
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
			where: { key: { equals: MEASUREMENT_PREFERENCE_KEY } },
		})
		expect(found.docs[0]?.value).toEqual({ bodyWeight: 'lb' })
	})
})
