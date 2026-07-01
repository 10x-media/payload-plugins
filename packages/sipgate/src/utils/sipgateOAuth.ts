const SIPGATE_LOGIN_BASE = 'https://login.sipgate.com/auth/realms'

/**
 * Default OAuth2 scopes. These must match the scopes enabled for your OAuth2
 * client in the sipgate console (console.sipgate.com). Override via
 * `sipgateCredentials.scopes` if your client has a different set.
 */
export const DEFAULT_OAUTH_SCOPES = ['all']

export type OAuthTokens = {
	access_token: string
	refresh_token: string
	expires_in: number
}

type BuildAuthorizeUrlOptions = {
	clientId: string
	realm: string
	redirectUri: string
	scopes: string[]
	state: string
}

export const buildAuthorizeUrl = ({
	clientId,
	realm,
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
	return `${SIPGATE_LOGIN_BASE}/${realm}/protocol/openid-connect/auth?${params.toString()}`
}

type ExchangeCodeOptions = {
	clientId: string
	clientSecret: string
	realm: string
	code: string
	redirectUri: string
}

export const exchangeCode = async ({
	clientId,
	clientSecret,
	realm,
	code,
	redirectUri,
}: ExchangeCodeOptions): Promise<OAuthTokens> => {
	const response = await fetch(`${SIPGATE_LOGIN_BASE}/${realm}/protocol/openid-connect/token`, {
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
	clientId: string
	clientSecret: string
	realm: string
	refreshToken: string
}

export const refreshAccessToken = async ({
	clientId,
	clientSecret,
	realm,
	refreshToken,
}: RefreshAccessTokenOptions): Promise<OAuthTokens> => {
	const response = await fetch(`${SIPGATE_LOGIN_BASE}/${realm}/protocol/openid-connect/token`, {
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
