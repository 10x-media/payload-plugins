import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { resolveConsentSourcesRequest } from './resolveConsentSourcesRequest'
import type { ConsentSourceEntry } from './types'

const entries: ConsentSourceEntry[] = [
	{ id: 'privacy-id', name: 'Privacy policy' },
	{ id: 'marketing-id' },
]

const makeReq = () => ({ context: {} }) as unknown as PayloadRequest

const makePayload = (findByID = vi.fn().mockResolvedValue({ id: 'form-1', title: 'Contact' })) =>
	({ findByID }) as unknown as Payload

const args = (over: Partial<Parameters<typeof resolveConsentSourcesRequest>[0]> = {}) => ({
	payload: makePayload(),
	formId: 'form-1' as string | number | undefined,
	isAuthed: true,
	req: makeReq(),
	resolver: vi.fn().mockResolvedValue(entries),
	...over,
})

describe('resolveConsentSourcesRequest', () => {
	it('serves the host sources as select options to an authenticated caller', async () => {
		expect(await resolveConsentSourcesRequest(args())).toEqual({
			status: 200,
			body: {
				options: [
					{ label: 'Privacy policy', value: 'privacy-id' },
					{ label: 'marketing-id', value: 'marketing-id' },
				],
			},
		})
	})

	it('refuses an anonymous caller before resolving anything', async () => {
		const resolver = vi.fn()
		const result = await resolveConsentSourcesRequest(args({ isAuthed: false, resolver }))
		expect(result.status).toBe(403)
		expect(resolver).not.toHaveBeenCalled()
	})

	it('scopes resolution to the request and form, so a tenant resolver can narrow it', async () => {
		const resolver = vi.fn().mockResolvedValue(entries)
		const req = makeReq()
		await resolveConsentSourcesRequest(args({ req, resolver }))
		expect(resolver).toHaveBeenCalledWith({ req, form: { id: 'form-1', title: 'Contact' } })
	})

	it('loads the form under the caller access (no overrideAccess), so a cross-tenant read is refused', async () => {
		const findByID = vi.fn().mockResolvedValue({ id: 'form-1', title: 'Contact' })
		await resolveConsentSourcesRequest(args({ payload: makePayload(findByID) }))
		expect(findByID).toHaveBeenCalledWith(expect.not.objectContaining({ overrideAccess: true }))
	})

	it('400s without a form id', async () => {
		expect((await resolveConsentSourcesRequest(args({ formId: undefined }))).status).toBe(400)
	})

	it('404s for an unknown form', async () => {
		const payload = makePayload(vi.fn().mockRejectedValue(new Error('not found')))
		expect((await resolveConsentSourcesRequest(args({ payload }))).status).toBe(404)
	})

	it('fails closed with a 503 when the resolver throws', async () => {
		const resolver = vi.fn().mockRejectedValue(new Error('tenant lookup down'))
		const result = await resolveConsentSourcesRequest(args({ resolver }))
		expect(result.status).toBe(503)
		expect(result.body).toEqual({ errors: [{ message: 'Consent sources unavailable' }] })
	})
})
