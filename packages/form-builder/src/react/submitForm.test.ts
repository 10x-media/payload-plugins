import { describe, expect, it, vi } from 'vitest'
import { submitForm } from './submitForm'

const values = [{ field: 'email', value: 'x' }]

describe('submitForm', () => {
	it('POSTs { form, values } to {apiRoute}/form-submissions and returns the doc id on 201', async () => {
		const fetchImpl = vi.fn<typeof fetch>(
			async () => new Response(JSON.stringify({ doc: { id: '1' } }), { status: 201 })
		)
		const result = await submitForm({ formId: 'f1', values, apiRoute: '/api', fetchImpl })
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.submissionId).toBe('1')
		}
		const call = fetchImpl.mock.calls[0]
		expect(call?.[0]).toBe('/api/form-submissions')
		expect(JSON.parse(String((call?.[1] as RequestInit | undefined)?.body))).toEqual({
			form: 'f1',
			values,
		})
	})

	it('parses the 400 ValidationError into per-field errors', async () => {
		const body = {
			errors: [
				{
					name: 'ValidationError',
					message: 'invalid',
					data: { errors: [{ path: 'email', message: 'Bad email' }] },
				},
			],
		}
		const fetchImpl = vi.fn(async () => new Response(JSON.stringify(body), { status: 400 }))
		const result = await submitForm({ formId: 'f1', values, apiRoute: '/api', fetchImpl })
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.fieldErrors).toEqual({ email: ['Bad email'] })
		}
	})

	it('returns a generic message on a non-validation failure', async () => {
		const fetchImpl = vi.fn(async () => new Response('boom', { status: 500 }))
		const result = await submitForm({ formId: 'f1', values, apiRoute: '/api', fetchImpl })
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.message).toBeTruthy()
		}
	})

	it('defaults apiRoute to /api', async () => {
		const fetchImpl = vi.fn<typeof fetch>(
			async () => new Response(JSON.stringify({ doc: { id: '2' } }), { status: 201 })
		)
		await submitForm({ formId: 'f1', values, fetchImpl })
		expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/form-submissions')
	})
})
