import type { TokenProvider } from './wildixClient'
import { type OAuthTokens, refreshAccessToken } from './wildixOAuth'

export type OAuthRefreshCallback = (tokens: OAuthTokens) => Promise<void>
export type OAuthRefreshFailedCallback = (error: Error) => Promise<void>

type BuildRefreshingTokenProviderOptions = {
	accessToken: string
	refreshToken: string
	/** ISO string or epoch millis of the current access token expiry, if known. */
	tokenExpiresAt?: string | number | null
	pbxHost: string
	clientId: string
	clientSecret: string
	onRefresh: OAuthRefreshCallback
	onRefreshFailed?: OAuthRefreshFailedCallback
}

/** Refresh the token this many milliseconds before its stated expiry. */
const EXPIRY_SKEW_MS = 30_000

/**
 * Builds a token provider that proactively refreshes the OAuth2 access token
 * before it expires and persists the new tokens via `onRefresh`. The WMS/WDA
 * SDKs call `token()` before each request, so refresh happens transparently.
 */
export const buildRefreshingTokenProvider = ({
	accessToken,
	refreshToken,
	tokenExpiresAt,
	pbxHost,
	clientId,
	clientSecret,
	onRefresh,
	onRefreshFailed,
}: BuildRefreshingTokenProviderOptions): TokenProvider => {
	let currentAccessToken = accessToken
	let currentRefreshToken = refreshToken
	let expiresAtMs = normalizeExpiry(tokenExpiresAt)
	let inflight: Promise<void> | null = null

	const doRefresh = async () => {
		try {
			const tokens = await refreshAccessToken({
				pbxHost,
				clientId,
				clientSecret,
				refreshToken: currentRefreshToken,
			})
			currentAccessToken = tokens.access_token
			currentRefreshToken = tokens.refresh_token
			expiresAtMs = Date.now() + tokens.expires_in * 1000
			await onRefresh(tokens)
		} catch (err) {
			await onRefreshFailed?.(err instanceof Error ? err : new Error(String(err)))
			throw err
		}
	}

	return {
		token: async () => {
			const expired = expiresAtMs != null && Date.now() >= expiresAtMs - EXPIRY_SKEW_MS
			if (expired) {
				if (!inflight) {
					inflight = doRefresh().finally(() => {
						inflight = null
					})
				}
				await inflight
			}
			return currentAccessToken
		},
	}
}

const normalizeExpiry = (value: string | number | null | undefined): number | null => {
	if (value == null) return null
	if (typeof value === 'number') return value
	const parsed = Date.parse(value)
	return Number.isNaN(parsed) ? null : parsed
}
