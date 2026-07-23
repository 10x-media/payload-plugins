import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { resolvePollOptionsRequest } from './resolvePollOptionsRequest'

const makeReq = () => ({ context: {} }) as unknown as PayloadRequest

describe('resolvePollOptionsRequest', () => {
	it('refuses an anonymous caller before loading anything', async () => {
		const findByID = vi.fn()
		const result = await resolvePollOptionsRequest({
			payload: { findByID } as unknown as Payload,
			formId: 'form-1',
			isAuthed: false,
			req: makeReq(),
		})
		expect(result.status).toBe(403)
		expect(findByID).not.toHaveBeenCalled()
	})

	it('loads the form under the caller access (no overrideAccess), so a cross-tenant read is refused', async () => {
		const findByID = vi.fn().mockResolvedValue({ id: 'form-1', poll: {} })
		await resolvePollOptionsRequest({
			payload: { findByID } as unknown as Payload,
			formId: 'form-1',
			isAuthed: true,
			req: makeReq(),
		})
		expect(findByID).toHaveBeenCalledWith(expect.not.objectContaining({ overrideAccess: true }))
	})

	it('404s for an unknown form', async () => {
		const findByID = vi.fn().mockRejectedValue(new Error('not found'))
		const result = await resolvePollOptionsRequest({
			payload: { findByID } as unknown as Payload,
			formId: 'form-1',
			isAuthed: true,
			req: makeReq(),
		})
		expect(result.status).toBe(404)
	})
})
