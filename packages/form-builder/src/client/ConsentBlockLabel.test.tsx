import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConsentBlockLabel } from './ConsentBlockLabel'

const rowLabel = vi.hoisted(() => ({
	current: { data: {} as { source?: unknown }, rowNumber: 0 as number | undefined },
}))
const docInfo = vi.hoisted(() => ({
	current: {
		id: 'form-1' as number | string | undefined,
		collectionSlug: 'forms' as string | undefined,
	},
}))
vi.mock('@payloadcms/ui', () => ({
	useRowLabel: () => rowLabel.current,
	useDocumentInfo: () => docInfo.current,
	useConfig: () => ({ config: { routes: { api: '/api' } } }),
}))
vi.mock('../translations/useTranslation', () => ({
	useTranslation: () => ({
		t: (key: string) => (key === 'formBuilder:fieldType.consent' ? 'Consent' : key),
	}),
}))

afterEach(() => {
	cleanup()
	vi.clearAllMocks()
	vi.unstubAllGlobals()
})

describe('ConsentBlockLabel', () => {
	it('resolves the source id to its name via the consent-sources endpoint', async () => {
		rowLabel.current = { data: { source: 'src-9' }, rowNumber: 0 }
		docInfo.current = { id: 'form-1', collectionSlug: 'forms' }
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({ options: [{ label: 'Privacy Policy', value: 'src-9' }] }),
			})
		)
		const { container } = render(<ConsentBlockLabel typeLabelKey="formBuilder:fieldType.consent" />)
		expect(container.textContent).toContain('01 Consent')
		await waitFor(() => expect(container.textContent).toContain('Privacy Policy'))
	})

	it('shows just the numbered type label while unresolved / on an unsaved form (no fetch)', () => {
		rowLabel.current = { data: { source: 'src-9' }, rowNumber: 4 }
		docInfo.current = { id: undefined, collectionSlug: 'forms' }
		const fetchMock = vi.fn()
		vi.stubGlobal('fetch', fetchMock)
		const { container } = render(<ConsentBlockLabel typeLabelKey="formBuilder:fieldType.consent" />)
		expect(container.textContent).toBe('05 Consent')
		expect(fetchMock).not.toHaveBeenCalled()
	})
})
