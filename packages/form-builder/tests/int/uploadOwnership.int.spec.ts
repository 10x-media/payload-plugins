import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BootedPayload, bootPayload, describeForDb } from '@10x-media/payload-test-harness'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { formBuilder } from '../../src/index'
import { captureFileRef } from '../../src/uploads/captureFileRef'

describeForDb('form-builder upload ownership', { dbs: ['mongo'] }, (db) => {
	let booted: BootedPayload
	const staticDir = mkdtempSync(join(tmpdir(), 'fb-own-'))

	beforeAll(async () => {
		booted = await bootPayload({ plugin: formBuilder({ uploads: { upload: { staticDir } } }), db })
	})
	afterAll(async () => {
		await booted.stop()
		rmSync(staticDir, { recursive: true, force: true })
	})

	const upload = async (owner?: string) => {
		const doc = await booted.payload.create({
			collection: 'form-uploads',
			data: {},
			file: { data: Buffer.alloc(64, 1), mimetype: 'application/pdf', name: 'r.pdf', size: 64 },
		})
		if (owner) {
			await booted.payload.update({
				collection: 'form-uploads',
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
			collectionSlug: 'form-uploads',
			uploadId: id,
			config: {},
			expectedOwner,
		})

	it('an unstamped upload is capturable (non-breaking)', async () => {
		expect((await capture(await upload())).ok).toBe(true)
	})

	it('a stamped upload is capturable by the matching identity, not by a different one', async () => {
		const id = await upload('ip:1.1.1.1')
		expect((await capture(id, 'ip:1.1.1.1')).ok).toBe(true)
		expect((await capture(id, 'ip:2.2.2.2')).ok).toBe(false)
	})

	it('a stamped upload fails open when the submitter cannot be identified', async () => {
		const id = await upload('ip:1.1.1.1')
		expect((await capture(id, undefined)).ok).toBe(true)
	})
})
