import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./sipgateOAuth', () => ({
	refreshAccessToken: vi.fn(),
}))

describe('buildSipgateRestOAuth refresh token rotation', () => {
	let originalFetch: typeof global.fetch

	beforeEach(() => {
		originalFetch = global.fetch
	})

	afterEach(() => {
		global.fetch = originalFetch
		vi.clearAllMocks()
	})

	it('uses the rotated refresh token on subsequent refreshes, not the original', async () => {
		const { buildSipgateRestOAuth } = await import('./sipgateOAuthRest')
		const { refreshAccessToken } = await import('./sipgateOAuth')
		const mockRefresh = vi.mocked(refreshAccessToken)

		mockRefresh
			.mockResolvedValueOnce({
				access_token: 'access-2',
				refresh_token: 'refresh-2',
				expires_in: 300,
			})
			.mockResolvedValueOnce({
				access_token: 'access-3',
				refresh_token: 'refresh-3',
				expires_in: 300,
			})

		const mockFetch = vi
			.fn()
			.mockResolvedValueOnce(new Response('', { status: 401 }))
			.mockResolvedValueOnce(new Response('ok', { status: 200 }))
			.mockResolvedValueOnce(new Response('', { status: 401 }))
			.mockResolvedValueOnce(new Response('ok', { status: 200 }))

		global.fetch = mockFetch

		const rest = buildSipgateRestOAuth({
			accessToken: 'initial-access',
			refreshToken: 'initial-refresh',
			clientId: 'client-id',
			clientSecret: 'client-secret',
			realm: 'third-party',
			onRefresh: vi.fn(),
		})

		await rest('/test', { method: 'GET' })
		expect(mockRefresh.mock.calls[0]?.[0]?.refreshToken).toBe('initial-refresh')

		await rest('/test', { method: 'GET' })
		expect(mockRefresh.mock.calls[1]?.[0]?.refreshToken).toBe('refresh-2')
	})
})
