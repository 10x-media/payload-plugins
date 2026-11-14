import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderStatusResponse } from '../../providers/connectionState'
import { keys } from '../../translations/keys'
import { SourceConnectionNote } from './SourceConnectionNote'

vi.mock('@payloadcms/ui', () => ({
	useTranslation: () => ({
		i18n: { language: 'en' },
		t: (key: string, vars?: Record<string, string>) =>
			vars ? `${key} ${Object.values(vars).join(' ')}` : key,
	}),
}))

const fetchMock = vi.fn<typeof fetch>()

const ENDPOINT = '/api/_x/provider-status'

const renderNote = async (
	sourceId: string,
	{ endpoint }: { endpoint?: string } = { endpoint: ENDPOINT }
) => {
	const result = render(
		<SourceConnectionNote endpoint={endpoint} locale="en" sourceId={sourceId} />
	)
	await act(async () => {})
	return result
}

beforeEach(() => {
	fetchMock.mockReset()
	vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
	cleanup()
	vi.unstubAllGlobals()
})

describe('SourceConnectionNote', () => {
	it("says what the vendor answered and until when reads rest, for the source's document", async () => {
		const body: ProviderStatusResponse = {
			status: {
				lastErrorAt: '2026-11-09T10:00:00.000Z',
				errorKind: 'source_misconfigured',
				errorDetail: 'posthog: HTTP 403 Invalid personal API key.',
				pausedUntil: '2999-01-01T10:00:00.000Z',
			},
		}
		fetchMock.mockImplementation(() => Promise.resolve(Response.json(body)))
		await renderNote('posthog:6650f1c2a9e4b3d2c1a09f87')
		expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${ENDPOINT}?id=6650f1c2a9e4b3d2c1a09f87`)
		// Named and with the status after the words, as the provider form's Connection panel says it.
		expect(screen.getByText(`${keys.providerNamePosthog}: Invalid personal API key.`)).toBeDefined()
		expect(screen.getByText(new RegExp(`^${keys.providerConnectionPaused} .*2999`))).toBeDefined()
	})

	it('says when the source last worked, for a vendor that stopped answering', async () => {
		fetchMock.mockImplementation(() =>
			Promise.resolve(
				Response.json({
					status: {
						lastSuccessAt: '2026-11-08T09:00:00.000Z',
						lastErrorAt: '2026-11-09T10:00:00.000Z',
						errorKind: 'unavailable',
					},
				})
			)
		)
		await renderNote('plausible:5')
		expect(
			screen.getByText(new RegExp(`^${keys.providerConnectionLastSuccess}: .*2026`))
		).toBeDefined()
	})

	it('says nothing to a reader the document is closed to', async () => {
		fetchMock.mockImplementation(() =>
			Promise.resolve(
				Response.json({ error: { code: 'not_found', message: 'no' } }, { status: 404 })
			)
		)
		const { container } = await renderNote('plausible:5')
		expect(container.innerHTML).toBe('')
	})

	it('asks nothing for a config source or an install without provider documents', async () => {
		await renderNote('posthog')
		await renderNote('plausible:5', {})
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('says nothing for a pause already over and no vendor words', async () => {
		fetchMock.mockImplementation(() =>
			Promise.resolve(Response.json({ status: { pausedUntil: '2000-01-01T00:00:00.000Z' } }))
		)
		const { container } = await renderNote('umami:7')
		expect(container.innerHTML).toBe('')
	})
})
