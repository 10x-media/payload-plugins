import type { SipgateRestFetch } from './sipgate.rest'
import { type OAuthTokens, refreshAccessToken } from './sipgateOAuth'

const BASE_URL = 'https://api.sipgate.com/v2'

export type OAuthRefreshCallback = (tokens: OAuthTokens) => Promise<void>
export type OAuthRefreshFailedCallback = (error: Error) => Promise<void>

type BuildSipgateRestOAuthOptions = {
	accessToken: string
	refreshToken: string
	clientId: string
	clientSecret: string
	realm: string
	onRefresh: OAuthRefreshCallback
	onRefreshFailed?: OAuthRefreshFailedCallback
}

/**
 * Builds a REST fetch function that authenticates with Bearer tokens and
 * automatically refreshes the access token on 401, then retries once.
 */
export const buildSipgateRestOAuth = ({
	accessToken: initialAccessToken,
	refreshToken,
	clientId,
	clientSecret,
	realm,
	onRefresh,
	onRefreshFailed,
}: BuildSipgateRestOAuthOptions): SipgateRestFetch => {
	let currentAccessToken = initialAccessToken
	let currentRefreshToken = refreshToken
	let inflight: Promise<void> | null = null

	const doRefresh = async () => {
		try {
			const tokens = await refreshAccessToken({
				clientId,
				clientSecret,
				realm,
				refreshToken: currentRefreshToken,
			})
			currentAccessToken = tokens.access_token
			currentRefreshToken = tokens.refresh_token
			await onRefresh(tokens)
		} catch (err) {
			await onRefreshFailed?.(err instanceof Error ? err : new Error(String(err)))
			throw err
		}
	}

	return async (url, options) => {
		const makeRequest = () =>
			fetch(BASE_URL + url, {
				...options,
				headers: {
					'Content-Type': 'application/json',
					...(options.headers as Record<string, string> | undefined),
					Authorization: `Bearer ${currentAccessToken}`,
				},
			})

		let response = await makeRequest()

		if (response.status === 401) {
			if (!inflight) {
				inflight = doRefresh().finally(() => {
					inflight = null
				})
			}
			await inflight
			response = await makeRequest()
		}

		return response
	}
}
