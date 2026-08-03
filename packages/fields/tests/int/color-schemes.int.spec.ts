import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { fields } from '../../src/index'

const probe: CollectionConfig = {
	slug: 'probe',
	fields: [
		{ name: 'ref', type: 'text' },
		{
			name: 'refResolved',
			type: 'json',
			admin: { disableListColumn: true, hidden: true },
			hooks: {
				afterRead: [
					({ siblingData }) => {
						const raw = (siblingData as Record<string, unknown> | undefined)?.ref
						if (typeof raw !== 'string' || raw === '') return null
						return { dark: `${raw}-dark`, light: `${raw}-light` }
					},
				],
			},
			virtual: true,
		},
	],
}

describeForDb('virtual json sibling', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({ collections: [probe], db, plugin: fields({}) })
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('resolves on read and stores no column', async () => {
		const created = await booted.payload.create({ collection: 'probe', data: { ref: 'brand' } })
		expect(created.refResolved).toEqual({ dark: 'brand-dark', light: 'brand-light' })

		const read = await booted.payload.findByID({ collection: 'probe', id: created.id })
		expect(read.refResolved).toEqual({ dark: 'brand-dark', light: 'brand-light' })
	})

	it('resolves to null when the source field is empty', async () => {
		const created = await booted.payload.create({ collection: 'probe', data: {} })
		expect(created.refResolved).toBeNull()
	})
})
