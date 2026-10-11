import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsScopeTokenProvider } from './scopeTokenContext'
import { useRequestScope } from './useRequestScope'

const auth = vi.hoisted(() => ({ user: { id: 7 } as { id: number } | null }))

vi.mock('@payloadcms/ui', () => ({ useAuth: () => ({ user: auth.user }) }))

let seen = ''

const Probe = () => {
	seen = useRequestScope()
	return null
}

beforeEach(() => {
	auth.user = { id: 7 }
	seen = ''
	// What script can see: an HttpOnly tenant cookie is never among it.
	vi.spyOn(document, 'cookie', 'get').mockReturnValue('payload-theme=dark')
})

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

describe('useRequestScope', () => {
	// The tenant lives in an HttpOnly cookie: the page's cookies read the same for both tenants,
	// and only the server's token tells the two apart.
	it("keys on the server's token, which sees the tenant the page's cookies hide", () => {
		const { rerender } = render(
			<AnalyticsScopeTokenProvider token="token-for-alpha">
				<Probe />
			</AnalyticsScopeTokenProvider>
		)
		const alpha = seen
		rerender(
			<AnalyticsScopeTokenProvider token="token-for-beta">
				<Probe />
			</AnalyticsScopeTokenProvider>
		)
		expect(seen).not.toBe(alpha)
		expect(alpha).toContain('token-for-alpha')
	})

	it('falls back to the cookies the page can read where no provider rendered a token', () => {
		render(<Probe />)
		expect(seen).toBe('7#payload-theme=dark')
	})

	it('answers nothing while nobody is signed in, token or not', () => {
		auth.user = null
		render(
			<AnalyticsScopeTokenProvider token="token-for-alpha">
				<Probe />
			</AnalyticsScopeTokenProvider>
		)
		expect(seen).toBe('')
	})
})
