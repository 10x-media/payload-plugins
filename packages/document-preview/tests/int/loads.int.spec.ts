import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { documentPreview } from '../../src/index'
import { getRegistry } from '../../src/plugin/registry'

const media: CollectionConfig = {
	slug: 'media',
	fields: [{ name: 'alt', type: 'text' }],
	upload: true,
}

describeForDb('documentPreview loads', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload

	beforeAll(async () => {
		booted = await bootPayload({
			collections: [media],
			db,
			plugin: documentPreview({
				collections: { media: { display: 'both', listView: true } },
				viewers: { 'video/*': '/viewers#Player' },
			}),
		})
	})

	afterAll(async () => {
		await booted.stop()
	})

	it('keeps the registry on the sanitized config for the admin provider', () => {
		expect(getRegistry(booted.payload.config)).toEqual({
			collections: {
				media: {
					display: 'both',
					fileIcons: true,
					filesizeCell: true,
					listView: true,
					viewers: {},
				},
			},
			viewers: { 'video/*': '/viewers#Player' },
		})
	})

	it('stores uploads with the preview ui fields in place', async () => {
		const doc = await booted.payload.create({
			collection: 'media',
			data: { alt: 'notes' },
			file: {
				data: Buffer.from('a,b\n1,2\n'),
				mimetype: 'text/csv',
				name: 'notes.csv',
				size: 8,
			},
		})
		expect(doc.filename).toMatch(/^notes(-\d+)?\.csv$/)
		expect(doc.mimeType).toBe('text/csv')
		expect(typeof doc.url).toBe('string')
		expect(doc).not.toHaveProperty('documentPreview')
		expect(doc.filesize).toBe(8)
	})

	it('gives non-image uploads an icon thumbnail and leaves images to Payload', async () => {
		const pdf = await booted.payload.create({
			collection: 'media',
			data: {},
			file: { data: Buffer.from('%PDF-1.4'), mimetype: 'application/pdf', name: 'a.pdf', size: 8 },
		})
		expect(pdf.thumbnailURL).toMatch(/^\/api\/document-preview\/file-icon\/pdf\?v=\w+$/)
		const svg = await booted.payload.create({
			collection: 'media',
			data: {},
			file: {
				data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'),
				mimetype: 'image/svg+xml',
				name: 'a.svg',
				size: 60,
			},
		})
		expect(svg.thumbnailURL ?? null).toBeNull()
	})

	it('merges the filesize cell into the upload field instead of adding a second one', () => {
		const fields = (booted.payload.collections.media?.config.fields ?? []).filter(
			(field) => 'name' in field && field.name === 'filesize'
		)
		expect(fields).toHaveLength(1)
		expect(fields[0]).toMatchObject({
			admin: {
				components: { Cell: '@10x-media/document-preview/client#DocumentPreviewFilesizeCell' },
				hidden: true,
				readOnly: true,
			},
			type: 'number',
		})
	})
})
