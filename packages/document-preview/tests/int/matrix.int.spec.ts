import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { documentPreview } from '../../src/index'

describeForDb('documentPreview cross-db', {}, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [{ slug: 'media', fields: [], upload: true }],
			db,
			plugin: documentPreview({ collections: { media: { display: 'both', listView: true } } }),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it(`boots against ${db} with the preview ui fields adding no columns`, async () => {
		const doc = await booted.payload.create({
			collection: 'media',
			data: {},
			file: { data: Buffer.from('hello'), mimetype: 'text/plain', name: 'hello.txt', size: 5 },
		})
		expect(doc.filename).toMatch(/^hello(-\d+)?\.txt$/)
	})
})
