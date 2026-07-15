/**
 * Default OAuth2 scopes. Wildix enforces least-privilege scopes on API keys and
 * OAuth2 clients. `*:*` grants full access and is intended for development only;
 * scope down (e.g. `['users:read', 'messaging:*']`) for production.
 */
export const DEFAULT_OAUTH_SCOPES = ['*:*']

export type OAuthTokens = {
	access_token: string
	refresh_token: string
	expires_in: number
}

/** Builds the base authorization/token URLs from a PBX host. */
const oauthBase = (pbxHost: string): string => `https://${pbxHost}/authorization`

type BuildAuthorizeUrlOptions = {
	pbxHost: string
	clientId: string
	redirectUri: string
	scopes: string[]
	state: string
}

export const buildAuthorizeUrl = ({
	pbxHost,
	clientId,
	redirectUri,
	scopes,
	state,
}: BuildAuthorizeUrlOptions): string => {
	const params = new URLSearchParams({
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: scopes.join(' '),
		response_type: 'code',
		state,
	})
	return `${oauthBase(pbxHost)}/oauth2?${params.toString()}`
}

type ExchangeCodeOptions = {
	pbxHost: string
	clientId: string
	clientSecret: string
	code: string
	redirectUri: string
}

export const exchangeCode = async ({
	pbxHost,
	clientId,
	clientSecret,
	code,
	redirectUri,
}: ExchangeCodeOptions): Promise<OAuthTokens> => {
	const response = await fetch(`${oauthBase(pbxHost)}/oauth2Token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			redirect_uri: redirectUri,
			grant_type: 'authorization_code',
		}).toString(),
	})
	if (!response.ok) {
		const body = await response.text().catch(() => '')
		throw new Error(`Token exchange failed: ${response.status} ${body}`)
	}
	return (await response.json()) as OAuthTokens
}

type RefreshAccessTokenOptions = {
	pbxHost: string
	clientId: string
	clientSecret: string
	refreshToken: string
}

export const refreshAccessToken = async ({
	pbxHost,
	clientId,
	clientSecret,
	refreshToken,
}: RefreshAccessTokenOptions): Promise<OAuthTokens> => {
	const response = await fetch(`${oauthBase(pbxHost)}/oauth2Token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			refresh_token: refreshToken,
			grant_type: 'refresh_token',
		}).toString(),
	})
	if (!response.ok) {
		const body = await response.text().catch(() => '')
		throw new Error(`Token refresh failed: ${response.status} ${body}`)
	}
	return (await response.json()) as OAuthTokens
}
