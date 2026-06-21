import { describe, expect, it, vi } from 'vitest'
import { uploadFile } from './uploadFile'

const okResponse = (body: unknown): Response =>
	({ ok: true, status: 200, json: async () => body }) as unknown as Response

const file = () => new File(['data'], 'resume.pdf', { type: 'application/pdf' })

describe('uploadFile', () => {
	it('POSTs the file to the default collection and returns the id', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(okResponse({ doc: { id: 'up1' } }))
		const result = await uploadFile({ file: file(), fetchImpl })
		expect(result).toEqual({ ok: true, id: 'up1' })
		expect(fetchImpl).toHaveBeenCalledWith(
			'/api/form-uploads',
			expect.objectContaining({ method: 'POST', body: expect.any(FormData) })
		)
	})

	it('honours a custom collection and apiRoute', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(okResponse({ doc: { id: 7 } }))
		const result = await uploadFile({
			file: file(),
			collection: 'media',
			apiRoute: '/cms',
			fetchImpl,
		})
		expect(fetchImpl).toHaveBeenCalledWith('/cms/media', expect.anything())
		expect(result).toEqual({ ok: true, id: 7 })
	})

	it('returns an error result on a non-ok response', async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue({ ok: false, status: 413, json: async () => ({}) } as unknown as Response)
		expect(await uploadFile({ file: file(), fetchImpl })).toEqual({
			ok: false,
			message: 'Upload failed (413)',
		})
	})

	it('returns an error result when fetch throws', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'))
		expect(await uploadFile({ file: file(), fetchImpl })).toEqual({ ok: false, message: 'offline' })
	})

	it('returns an error result when no id is returned', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(okResponse({ doc: {} }))
		const result = await uploadFile({ file: file(), fetchImpl })
		expect(result.ok).toBe(false)
	})
})
