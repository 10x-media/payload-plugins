import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ActionRunArgs } from '../defineAction'
import { SIGNATURE_HEADER, signPayload } from '../sign'
import { signedWebhook, validateUrl } from './signedWebhook'

const form = { id: 'form-1', title: 'Test' }
const submissionId = 'sub-1'
const locale = 'en'
const t = (key: string) => key

const baseArgs = (overrides: Partial<ActionRunArgs<Record<string, unknown>>> = {}) =>
	({
		form,
		submissionId,
		locale,
		t,
		descriptors: [],
		req: undefined,
		...overrides,
	}) as ActionRunArgs<Record<string, unknown>>

const makePayload = () => ({}) as unknown as Parameters<typeof signedWebhook.run>[0]['payload']

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('signedWebhook', () => {
	it('POSTs JSON body with correct signature header', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
		vi.stubGlobal('fetch', fetchMock)

		const values = [{ field: 'name', value: 'Alice' }]

		await signedWebhook.run(
			baseArgs({
				config: { url: 'https://example.com/hook', secret: 'mysecret' },
				values,
				payload: makePayload(),
			})
		)

		expect(fetchMock).toHaveBeenCalledOnce()
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('https://example.com/hook')
		expect(init.method).toBe('POST')

		const sentBody = init.body as string
		const parsed = JSON.parse(sentBody) as { formId: string; submissionId: string; values: unknown }
		expect(parsed.formId).toBe('form-1')
		expect(parsed.submissionId).toBe('sub-1')

		const headers = init.headers as Record<string, string>
		expect(headers['Content-Type']).toBe('application/json')
		expect(headers[SIGNATURE_HEADER]).toBe(signPayload(sentBody, 'mysecret'))
	})

	it('throws on non-2xx response', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

		await expect(
			signedWebhook.run(
				baseArgs({
					config: { url: 'https://example.com/hook', secret: 'sec' },
					values: [],
					payload: makePayload(),
				})
			)
		).rejects.toThrow('500')
	})

	it('throws when url is missing', async () => {
		await expect(
			signedWebhook.run(
				baseArgs({
					config: { url: '', secret: 'sec' },
					values: [],
					payload: makePayload(),
				})
			)
		).rejects.toThrow('missing "url"')
	})

	it('throws when secret is missing', async () => {
		await expect(
			signedWebhook.run(
				baseArgs({
					config: { url: 'https://example.com/hook', secret: '' },
					values: [],
					payload: makePayload(),
				})
			)
		).rejects.toThrow('missing "secret"')
	})
})

describe('validateUrl', () => {
	const req = { t: (key: string) => key } as unknown as Parameters<typeof validateUrl>[1]['req']

	it('passes when unset', () => {
		expect(validateUrl(undefined, { req })).toBe(true)
		expect(validateUrl('', { req })).toBe(true)
	})

	it('passes a valid https URL', () => {
		expect(validateUrl('https://example.com/hook', { req })).toBe(true)
	})

	it('passes a valid http URL', () => {
		expect(validateUrl('http://example.com/hook', { req })).toBe(true)
	})

	it('fails a non-http(s) protocol', () => {
		expect(validateUrl('ftp://example.com/hook', { req })).toBe('formBuilder:validation.urlInvalid')
	})

	it('fails a javascript: URL', () => {
		expect(validateUrl('javascript:alert(1)', { req })).toBe('formBuilder:validation.urlInvalid')
	})

	it('fails a value that does not parse as a URL', () => {
		expect(validateUrl('plain text', { req })).toBe('formBuilder:validation.urlInvalid')
	})

	it('fails a bare hostname with no protocol', () => {
		expect(validateUrl('example.com', { req })).toBe('formBuilder:validation.urlInvalid')
	})
})
