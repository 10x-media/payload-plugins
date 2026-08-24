import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EndpointOptionsSelect } from './EndpointOptionsSelect'

const documentInfo = vi.hoisted(() => ({
	current: { id: undefined as number | string | undefined, collectionSlug: 'forms' },
}))
vi.mock('@payloadcms/ui', () => ({
	useField: () => ({ path: 'from', setValue: vi.fn(), value: '' }),
	useDocumentInfo: () => documentInfo.current,
	useConfig: () => ({ config: { routes: { api: '/api' } } }),
	FieldLabel: () => null,
	FieldDescription: () => null,
	ReactSelect: () => null,
}))
vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
	documentInfo.current = { id: undefined, collectionSlug: 'forms' }
})

const okFetch = () => vi.fn().mockResolvedValue({ ok: true, json: async () => ({ options: [] }) })

describe('EndpointOptionsSelect scope', () => {
	it('fetches a request-scoped endpoint at the id-less URL while the document is unsaved', () => {
		const fetchSpy = okFetch()
		vi.stubGlobal('fetch', fetchSpy)
		render(<EndpointOptionsSelect endpoint="from-addresses" scope="request" />)
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/forms/from-addresses')
	})

	it('keeps the id-less URL once the document is saved, so the URL never flips', () => {
		documentInfo.current = { id: 7, collectionSlug: 'forms' }
		const fetchSpy = okFetch()
		vi.stubGlobal('fetch', fetchSpy)
		render(<EndpointOptionsSelect endpoint="from-addresses" scope="request" />)
		expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/forms/from-addresses')
	})

	it('still skips a document-scoped fetch while the document is unsaved', () => {
		const fetchSpy = okFetch()
		vi.stubGlobal('fetch', fetchSpy)
		render(<EndpointOptionsSelect endpoint="poll-options" />)
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it('fetches a document-scoped endpoint at the id path once saved', () => {
		documentInfo.current = { id: 7, collectionSlug: 'forms' }
		const fetchSpy = okFetch()
		vi.stubGlobal('fetch', fetchSpy)
		render(<EndpointOptionsSelect endpoint="poll-options" />)
		expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/forms/7/poll-options')
	})
})
