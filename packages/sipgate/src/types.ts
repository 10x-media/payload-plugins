export type SipgateAuthType = 'pat' | 'oauth2'

export interface SipgateCredentials {
	/**
	 * The authentication method to use.
	 */
	authType: SipgateAuthType

	/**
	 * Sipgate Personal Access Token ID (TokenId). Required if authType is 'pat'.
	 */
	tokenId?: string

	/**
	 * Sipgate Personal Access Token (Token). Required if authType is 'pat'.
	 */
	token?: string

	/**
	 * Sipgate OAuth2 Client ID. Required if authType is 'oauth2'.
	 */
	clientId?: string

	/**
	 * Sipgate OAuth2 Client Secret. Required if authType is 'oauth2'.
	 */
	clientSecret?: string

	/**
	 * Sipgate OAuth2 Refresh Token. Required if authType is 'oauth2' for background syncing.
	 */
	refreshToken?: string
}
