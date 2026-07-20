import type { Payload, PayloadRequest } from 'payload'
import { describe, expect, it, vi } from 'vitest'
import { resolveConsentStatements } from './resolveConsentStatements'
import type { ConsentSourceEntry } from './types'

const payload = { config: { custom: {} } } as unknown as Payload
const makeReq = () => ({ context: {} }) as unknown as PayloadRequest

const statement = (text: string) => ({
	root: { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', text }] }] },
})

const privacy: ConsentSourceEntry = {
	id: 'privacy-id',
	name: 'Privacy policy',
	statement: statement('I agree to the privacy policy'),
	page: { relationTo: 'pages', id: 'page-1' },
	url: 'https://example.com/privacy',
}
const marketing: ConsentSourceEntry = { id: 'marketing-id', statement: statement('Send me email') }
const entries: ConsentSourceEntry[] = [privacy, marketing]

const form = {
	id: 'form-1',
	fields: [
		{ blockType: 'text', name: 'email' },
		{ blockType: 'consent', name: 'terms', source: 'privacy-id' },
		{ blockType: 'consent', name: 'news', source: 'marketing-id' },
	],
}

describe('resolveConsentStatements', () => {
	it('keys the resolved statement and link by consent field name', async () => {
		const sources = vi.fn().mockResolvedValue(entries)
		expect(await resolveConsentStatements({ payload, req: makeReq(), form, sources })).toEqual({
			terms: {
				statement: privacy.statement,
				link: { label: 'Privacy policy', url: 'https://example.com/privacy' },
			},
			news: { statement: marketing.statement },
		})
	})

	it('adds no link for a source with a url but no name, never showing the raw id to a visitor', async () => {
		const sources = vi.fn().mockResolvedValue([{ id: 'privacy-id', url: 'https://x.test/p' }])
		const result = await resolveConsentStatements({ payload, req: makeReq(), form, sources })
		expect(result.terms).toEqual({})
	})

	it('adds no link for a source with a blank name', async () => {
		const sources = vi
			.fn()
			.mockResolvedValue([{ id: 'privacy-id', name: '   ', url: 'https://x.test/p' }])
		const result = await resolveConsentStatements({ payload, req: makeReq(), form, sources })
		expect(result.terms).toEqual({})
	})

	it('adds no link for a source with no url, since only the host knows its routes', async () => {
		const sources = vi
			.fn()
			.mockResolvedValue([{ id: 'privacy-id', page: { relationTo: 'pages', id: 'page-1' } }])
		const result = await resolveConsentStatements({ payload, req: makeReq(), form, sources })
		expect(result.terms).toEqual({})
	})

	it('leaves out a field whose source the host no longer carries', async () => {
		const sources = vi.fn().mockResolvedValue([marketing])
		const result = await resolveConsentStatements({ payload, req: makeReq(), form, sources })
		expect(result).toEqual({ news: { statement: marketing.statement } })
	})

	it('passes through whatever the request locale resolved, without re-reading it', async () => {
		const de: ConsentSourceEntry = { id: 'privacy-id', statement: statement('Ich stimme zu') }
		const sources = vi.fn().mockResolvedValue([de])
		const result = await resolveConsentStatements({ payload, req: makeReq(), form, sources })
		expect(result.terms?.statement).toBe(de.statement)
	})

	it('never calls the resolver for a form with no consent fields', async () => {
		const sources = vi.fn()
		const result = await resolveConsentStatements({
			payload,
			req: makeReq(),
			form: { id: 'form-2', fields: [{ blockType: 'text', name: 'email' }] },
			sources,
		})
		expect(result).toEqual({})
		expect(sources).not.toHaveBeenCalled()
	})

	it('tolerates a form with no fields at all', async () => {
		expect(
			await resolveConsentStatements({
				payload,
				req: makeReq(),
				form: { id: 'f' },
				sources: vi.fn(),
			})
		).toEqual({})
	})

	it('skips a nameless consent row, since there is no field name to store its statement under', async () => {
		const sources = vi.fn().mockResolvedValue(entries)
		const result = await resolveConsentStatements({
			payload,
			req: makeReq(),
			form: { id: 'f', fields: [{ blockType: 'consent', source: 'privacy-id' }] },
			sources,
		})
		expect(result).toEqual({})
	})

	it('propagates a resolver failure so the page can decide how to fail', async () => {
		const sources = vi.fn().mockRejectedValue(new Error('sources down'))
		await expect(
			resolveConsentStatements({ payload, req: makeReq(), form, sources })
		).rejects.toThrow('sources down')
	})
})
