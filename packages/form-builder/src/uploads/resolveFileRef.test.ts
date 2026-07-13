import { describe, expect, it } from 'vitest'
import { resolveFileRef } from './resolveFileRef'

const doc = (over: Record<string, unknown> = {}) => ({
	id: 'u1',
	filename: 'resume.pdf',
	mimeType: 'application/pdf',
	filesize: 1000,
	url: '/uploads/resume.pdf',
	...over,
})

describe('resolveFileRef', () => {
	it('captures a snapshot when there are no constraints', () => {
		const result = resolveFileRef(doc(), {})
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
	})

	it('rejects a missing doc', () => {
		expect(resolveFileRef(null, {})).toEqual({ ok: false, code: 'missing' })
		expect(resolveFileRef(undefined, {})).toEqual({ ok: false, code: 'missing' })
	})

	it('allows an exact mime match', () => {
		expect(resolveFileRef(doc(), { mimeTypes: ['application/pdf'] }).ok).toBe(true)
	})

	it('allows a wildcard mime match', () => {
		expect(resolveFileRef(doc({ mimeType: 'image/png' }), { mimeTypes: ['image/*'] }).ok).toBe(true)
	})

	it('allows a prefix wildcard mime match (curated Office documents pattern)', () => {
		const pattern = 'application/vnd.openxmlformats-officedocument.*'
		expect(
			resolveFileRef(
				doc({
					mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
				}),
				{ mimeTypes: [pattern] }
			).ok
		).toBe(true)
		expect(
			resolveFileRef(doc({ mimeType: 'application/vnd.ms-excel' }), { mimeTypes: [pattern] })
		).toEqual({ ok: false, code: 'mimeType' })
	})

	it('rejects a mime not in the allowlist', () => {
		expect(
			resolveFileRef(doc({ mimeType: 'application/x-msdownload' }), {
				mimeTypes: ['application/pdf', 'image/*'],
			})
		).toEqual({
			ok: false,
			code: 'mimeType',
		})
	})

	it('rejects a file larger than maxSize', () => {
		expect(resolveFileRef(doc({ filesize: 5000 }), { maxSize: 4096 })).toEqual({
			ok: false,
			code: 'tooLarge',
		})
	})

	it('accepts a file at exactly maxSize', () => {
		expect(resolveFileRef(doc({ filesize: 4096 }), { maxSize: 4096 }).ok).toBe(true)
	})

	it('omits url from the ref when the doc has none', () => {
		const result = resolveFileRef(doc({ url: undefined }), {})
		expect(result).toEqual({
			ok: true,
			ref: { id: 'u1', filename: 'resume.pdf', mimeType: 'application/pdf', filesize: 1000 },
		})
	})

	it('coerces a numeric id and tolerates missing metadata fields', () => {
		const result = resolveFileRef({ id: 7 }, {})
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.ref.id).toBe(7)
			expect(result.ref.filename).toBe('')
			expect(result.ref.filesize).toBe(0)
		}
	})
})
