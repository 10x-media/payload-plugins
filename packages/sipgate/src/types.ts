export type SipgateAuthType = 'pat' | 'oauth2'

export type SipgateCredentials = {
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

export type SipgateNewCallWebhookData = {
	event: 'newcall'
	from: string
	to: string
	direction: 'in' | 'out'
	callId: string
	origCallId: string
	'user[]': string[]
	'userId[]': string[]
	'fullUserId[]': string[]
	xcid: string
}

export type SipgateAnswerWebhookData = {
	event: 'answer'
	from: string
	to: string
	direction: 'in' | 'out'
	callId: string
	user: string
	userId: string
	fullUserId: string
	answeringNumber: string
}

export type SipgateHangupWebhookData = {
	event: 'hangup'
	cause: 'normalClearing' | 'busy' | 'cancel' | 'noAnswer' | 'congestion' | 'notFound' | 'forwarded'
	callId: string
	from: string
	to: string
	direction: 'in' | 'out'
	answeringNumber: string
}
