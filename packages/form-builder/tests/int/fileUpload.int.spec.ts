import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'

describeForDb('form-builder file uploads', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	const staticDir = mkdtempSync(join(tmpdir(), 'fb-uploads-'))

	const appUploads: CollectionConfig = {
		slug: 'app-uploads',
		upload: { staticDir },
		fields: [],
	}

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({ uploads: { collection: 'app-uploads' } }),
			collections: [appUploads],
			db,
		})
	})

	afterAll(async () => {
		await booted.stop()
		rmSync(staticDir, { recursive: true, force: true })
	})

	const uploadPdf = async (size = 1024) =>
		booted.payload.create({
			collection: 'app-uploads',
			data: {},
			file: { data: Buffer.alloc(size, 1), mimetype: 'application/pdf', name: 'resume.pdf', size },
		})

	const makeForm = async (config: Record<string, unknown> = {}) =>
		booted.payload.create({
			collection: 'forms',
			data: {
				title: 'Application',
				fields: [{ blockType: 'file', name: 'resume', label: 'Resume', ...config }],
			},
		})

	it('appends the hidden owner field to the host collection', () => {
		const fields = booted.payload.collections['app-uploads']?.config.fields ?? []
		expect(fields.some((field) => 'name' in field && field.name === 'owner')).toBe(true)
	})

	it('stamps the configured collection slug onto file blocks on save', async () => {
		const form = await makeForm({ uploadsCollection: 'forged-by-author' })
		const fields = form.fields as Array<{ uploadsCollection?: string }>
		expect(fields[0]?.uploadsCollection).toBe('app-uploads')
	})

	it('captures a self-describing FileRef snapshot from the upload id', async () => {
		const form = await makeForm()
		const upload = await uploadPdf()
		const submission = await booted.payload.create({
			collection: 'form-submissions',
			depth: 0,
			data: { form: form.id, values: [{ field: 'resume', value: upload.id }] },
		})
		const values = submission.values as Array<{ field: string; value: Record<string, unknown> }>
		const entry = values.find((v) => v.field === 'resume')
		expect(entry?.value.id).toBe(upload.id)
		expect(entry?.value.filename).toBe('resume.pdf')
		expect(entry?.value.mimeType).toBe('application/pdf')
		expect(typeof entry?.value.filesize).toBe('number')
	})

	it('rejects a submission whose file violates the field mimeTypes allowlist', async () => {
		const form = await makeForm({ mimeTypes: ['image/png'] })
		const upload = await uploadPdf()
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [{ field: 'resume', value: upload.id }] },
			})
		).rejects.toThrow()
	})

	it('rejects a submission whose file exceeds maxSize', async () => {
		const form = await makeForm({ maxSize: 512 })
		const upload = await uploadPdf(2048)
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [{ field: 'resume', value: upload.id }] },
			})
		).rejects.toThrow()
	})

	it('rejects a required file field with no upload', async () => {
		const form = await makeForm({ required: true })
		await expect(
			booted.payload.create({
				collection: 'form-submissions',
				data: { form: form.id, values: [] },
			})
		).rejects.toThrow()
	})
})
