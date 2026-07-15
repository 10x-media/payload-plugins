import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import type { CollectionConfig } from 'payload'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'
import { captureFileRef } from '../../src/uploads/captureFileRef'

describeForDb('form-builder upload ownership', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	const staticDir = mkdtempSync(join(tmpdir(), 'fb-own-'))

	const appUploads: CollectionConfig = {
		slug: 'app-uploads',
		upload: { staticDir },
		fields: [],
	}

	beforeAll(async () => {
		booted = await bootPayload({
			plugin: formBuilder({
				uploads: { collection: 'app-uploads' },
				// max 6 leaves room for the three single-upload tests above the flood test (one window).
				spam: { identify: () => 'ip:9.9.9.9', uploadRateLimit: { max: 6, window: 60_000 } },
			}),
			collections: [appUploads],
			db,
		})
	})
	afterAll(async () => {
		await booted.stop()
		rmSync(staticDir, { recursive: true, force: true })
	})

	const upload = async (owner?: string) => {
		const doc = await booted.payload.create({
			collection: 'app-uploads',
			data: {},
			file: { data: Buffer.alloc(64, 1), mimetype: 'application/pdf', name: 'r.pdf', size: 64 },
		})
		if (owner) {
			await booted.payload.update({
				collection: 'app-uploads',
				id: doc.id,
				data: { owner },
				overrideAccess: true,
			})
		}
		return doc.id
	}

	const capture = (id: string | number, expectedOwner?: string) =>
		captureFileRef({
			payload: booted.payload,
			collectionSlug: 'app-uploads',
			uploadId: id,
			config: {},
			expectedOwner,
		})

	it('the attached hook stamps the resolved identity onto owner at create', async () => {
		const id = await upload()
		const doc = await booted.payload.findByID({ collection: 'app-uploads', id, depth: 0 })
		expect((doc as { owner?: string }).owner).toBe('ip:9.9.9.9')
	})

	it('a stamped upload is capturable by the matching identity, not by a different one', async () => {
		const id = await upload()
		expect((await capture(id, 'ip:9.9.9.9')).ok).toBe(true)
		expect((await capture(id, 'ip:2.2.2.2')).ok).toBe(false)
	})

	it('a stamped upload fails open when the submitter cannot be identified', async () => {
		const id = await upload('ip:1.1.1.1')
		expect((await capture(id, undefined)).ok).toBe(true)
	})

	it('the attached rate limit rejects an upload flood with a 429', async () => {
		await expect(
			(async () => {
				for (let i = 0; i < 10; i++) {
					await upload()
				}
			})()
		).rejects.toMatchObject({ status: 429 })
	})
})
