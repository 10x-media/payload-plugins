import { act, cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SourcesResponse } from '../fields/config/fetchSources'
import { keys } from '../translations/keys'
import { ProvidersListNotice } from './ProvidersListNotice'

vi.mock('@payloadcms/ui', () => ({
	Banner: ({ children }: { children?: ReactNode }) => <div role="status">{children}</div>,
	useAuth: () => ({ user: { id: 'user-1' } }),
	useConfig: () => ({
		config: { routes: { admin: '/admin', api: '/api' }, serverURL: 'https://cms.test' },
	}),
	useTranslation: () => ({ i18n: { language: 'en' }, t: (key: string) => key }),
}))

const fetchMock = vi.fn<typeof fetch>()

const answer = (body: SourcesResponse): void => {
	fetchMock.mockImplementation(() => Promise.resolve(Response.json(body)))
}

const listing: SourcesResponse = { defaultId: 'shared', sources: [] }

const renderNotice = async () => {
	const result = render(<ProvidersListNotice />)
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

describe('ProvidersListNotice', () => {
	it("tells a tenant on the platform's source that adding one switches to it", async () => {
		answer({ ...listing, notice: 'platformFallback' })
		await renderNotice()
		expect(screen.getByText(keys.sourcesPlatformFallback)).toBeDefined()
		expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/sources')
	})

	it('renders nothing for a listing without a notice', async () => {
		answer(listing)
		const { container } = await renderNotice()
		expect(container.innerHTML).toBe('')
	})

	it('renders nothing when the listing cannot be read', async () => {
		fetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 500 })))
		const { container } = await renderNotice()
		expect(container.innerHTML).toBe('')
	})

	// The list is where a source is added: coming back to it reads the listing again.
	it('reads the listing afresh on every mount rather than from the shared cache', async () => {
		answer({ ...listing, notice: 'platformFallback' })
		const first = await renderNotice()
		first.unmount()
		answer(listing)
		const { container } = await renderNotice()
		expect(fetchMock).toHaveBeenCalledTimes(2)
		expect(container.innerHTML).toBe('')
	})
})
