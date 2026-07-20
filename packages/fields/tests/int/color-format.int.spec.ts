import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { colorField } from '../../src/exports/color'
import { fields } from '../../src/index'

const colorFormats: CollectionConfig = {
	slug: 'colorFormats',
	fields: [colorField({ name: 'inherited' }), colorField({ name: 'pinnedHex', format: 'hex' })],
}

describeForDb('fields color plugin-level format default', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [colorFormats],
			db,
			plugin: fields({ color: { format: 'oklch' } }),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('stores the plugin default for a formatless field while a field-level format wins', async () => {
		const doc = await booted.payload.create({
			collection: 'colorFormats',
			data: { inherited: 'red', pinnedHex: 'red' },
		})
		expect(doc.inherited).toBe('oklch(0.628 0.2577 29.23)')
		expect(doc.pinnedHex).toBe('#ff0000')
	})
})
