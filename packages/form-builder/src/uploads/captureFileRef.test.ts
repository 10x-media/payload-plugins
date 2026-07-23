import type { Payload } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { captureFileRef } from './captureFileRef'

const uploadDoc = (over: Record<string, unknown> = {}) => ({
	id: 'u1',
	filename: 'resume.pdf',
	mimeType: 'application/pdf',
	filesize: 1000,
	url: '/uploads/resume.pdf',
	...over,
})

const payloadReturning = (doc: unknown, opts: { throws?: boolean } = {}) => {
	const findByID = vi.fn(async () => {
		if (opts.throws) {
			throw new Error('not found')
		}
		return doc
	})
	return { payload: { findByID } as unknown as Payload, findByID }
}

const base = { collectionSlug: 'uploads', uploadId: 'u1', config: {} }

describe('captureFileRef', () => {
	it('reads the upload authoritatively and snapshots an unstamped doc', async () => {
		const { payload, findByID } = payloadReturning(uploadDoc())
		const result = await captureFileRef({ payload, ...base })
		expect(result).toEqual({
			ok: true,
			ref: {
				id: 'u1',
				filename: 'resume.pdf',
				mimeType: 'application/pdf',
				filesize: 1000,
				url: '/uploads/resume.pdf',
			},
		})
		// The metadata is read from the stored doc, never the client, with access overridden.
		expect(findByID).toHaveBeenCalledWith(
			expect.objectContaining({ collection: 'uploads', id: 'u1', depth: 0, overrideAccess: true })
		)
	})

	it('passes an owner-matching upload through', async () => {
		const { payload } = payloadReturning(uploadDoc({ owner: 'user-1' }))
		const result = await captureFileRef({ payload, ...base, expectedOwner: 'user-1' })
		expect(result.ok).toBe(true)
	})

	it('rejects an owner-mismatched upload as missing (indistinguishable from a deleted one)', async () => {
		const { payload } = payloadReturning(uploadDoc({ owner: 'user-2' }))
		const result = await captureFileRef({ payload, ...base, expectedOwner: 'user-1' })
		expect(result).toEqual({ ok: false, code: 'missing' })
	})

	it('does not enforce ownership when the submitter is unidentified (fail-open)', async () => {
		const { payload } = payloadReturning(uploadDoc({ owner: 'user-2' }))
		const result = await captureFileRef({ payload, ...base })
		expect(result.ok).toBe(true)
	})

	it('passes an unstamped upload through even when an owner is expected', async () => {
		const { payload } = payloadReturning(uploadDoc())
		const result = await captureFileRef({ payload, ...base, expectedOwner: 'user-1' })
		expect(result.ok).toBe(true)
	})

	it('collapses a failed load to missing', async () => {
		const { payload } = payloadReturning(null, { throws: true })
		const result = await captureFileRef({ payload, ...base })
		expect(result).toEqual({ ok: false, code: 'missing' })
	})

	it('strict: rejects a stamped upload when the submitter is unidentifiable', async () => {
		const { payload } = payloadReturning(uploadDoc({ owner: 'user-2' }))
		const result = await captureFileRef({ payload, ...base, strict: true })
		expect(result).toEqual({ ok: false, code: 'missing' })
	})

	it('strict: still passes an owner-matching upload', async () => {
		const { payload } = payloadReturning(uploadDoc({ owner: 'user-1' }))
		const result = await captureFileRef({ payload, ...base, expectedOwner: 'user-1', strict: true })
		expect(result.ok).toBe(true)
	})

	it('strict: still passes an unstamped upload (nothing to verify against)', async () => {
		const { payload } = payloadReturning(uploadDoc())
		const result = await captureFileRef({ payload, ...base, strict: true })
		expect(result.ok).toBe(true)
	})
})
