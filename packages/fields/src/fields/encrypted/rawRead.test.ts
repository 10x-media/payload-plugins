import type { PayloadRequest } from 'payload'
import { describe, expect, it } from 'vitest'
import { withRawEncrypted } from './rawRead'
import { ENCRYPTED_CONTEXT_KEY } from './types'

const makeReq = (context?: Record<string, unknown>): PayloadRequest =>
	({ context, payload: {} }) as unknown as PayloadRequest

const modeOf = (req: PayloadRequest) => req.context?.[ENCRYPTED_CONTEXT_KEY]

describe('withRawEncrypted', () => {
	it('sets raw mode for the duration of the read', async () => {
		const req = makeReq({})
		const seen = await withRawEncrypted(req, async () => modeOf(req))
		expect(seen).toBe('raw')
	})

	it('removes the mode again when the request carried none', async () => {
		const req = makeReq({})
		await withRawEncrypted(req, async () => undefined)
		expect(ENCRYPTED_CONTEXT_KEY in (req.context as object)).toBe(false)
	})

	it('leaves unrelated context keys alone', async () => {
		const req = makeReq({ tenantId: 'acme' })
		await withRawEncrypted(req, async () => undefined)
		expect(req.context?.tenantId).toBe('acme')
	})

	it('restores an outer mode rather than clearing it, so windows nest', async () => {
		const req = makeReq({ [ENCRYPTED_CONTEXT_KEY]: 'rotate' })
		const inner = await withRawEncrypted(req, async () => modeOf(req))
		expect(inner).toBe('raw')
		expect(modeOf(req)).toBe('rotate')
	})

	it('restores the mode when the read throws', async () => {
		const req = makeReq({})
		await expect(
			withRawEncrypted(req, async () => {
				throw new Error('read failed')
			})
		).rejects.toThrow('read failed')
		expect(ENCRYPTED_CONTEXT_KEY in (req.context as object)).toBe(false)
	})

	it('gives a request with no context one to carry the mode', async () => {
		const req = makeReq(undefined)
		const seen = await withRawEncrypted(req, async () => modeOf(req))
		expect(seen).toBe('raw')
		expect(req.context).toEqual({})
	})

	/**
	 * A local API operation replaces `req.context` with a merged copy rather than
	 * mutating it in place, so a window that closed over the original object
	 * would restore the mode onto one nothing reads any more, leaving the live
	 * context in raw mode for the rest of the request.
	 */
	it('restores onto the context object the operation left behind', async () => {
		const req = makeReq({})
		await withRawEncrypted(req, async () => {
			req.context = { ...req.context }
		})
		expect(ENCRYPTED_CONTEXT_KEY in (req.context as object)).toBe(false)
	})

	it('isolates the dataloader for the window and puts the original back', async () => {
		const original = { marker: 'original' } as unknown as PayloadRequest['payloadDataLoader']
		const req = makeReq({})
		req.payloadDataLoader = original
		const during = await withRawEncrypted(req, async () => req.payloadDataLoader)
		expect(during).not.toBe(original)
		expect(typeof during?.load).toBe('function')
		expect(req.payloadDataLoader).toBe(original)
	})

	it('returns the read result', async () => {
		const req = makeReq({})
		await expect(withRawEncrypted(req, async () => 'value')).resolves.toBe('value')
	})
})
