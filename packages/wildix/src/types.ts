export type WildixAuthType = 'apiKey' | 'oauth2'

/** Corner of the admin UI where the live call floating window is anchored. */
export type LiveCallPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'

export type WildixCredentials = {
	/**
	 * The authentication method to use.
	 * - `apiKey`: server-to-server hierarchical API key (`wsk-v1-...`), sent as a Bearer token.
	 * - `oauth2`: per-user Authorization Code flow against the customer's PBX.
	 */
	authType: WildixAuthType

	/**
	 * PBX host, e.g. `mycompany.wildixin.com`. Used as the WMS API `domain` and to build
	 * OAuth2 authorize/token URLs. Required for both modes.
	 */
	pbxHost?: string

	/**
	 * Optional PBX port. Defaults to the WMS client default (443).
	 */
	port?: number

	/**
	 * Wildix API key (`wsk-v1-...`). Required when `authType` is `apiKey`.
	 */
	apiKey?: string

	/**
	 * OAuth2 client ID. Required when `authType` is `oauth2`.
	 */
	clientId?: string

	/**
	 * OAuth2 client secret. Required when `authType` is `oauth2`.
	 */
	clientSecret?: string

	/**
	 * OAuth2 scopes to request. Wildix API keys/clients require explicit scopes
	 * (least privilege). Defaults to `['*:*']` for development; scope down for production.
	 */
	scopes?: string[]

	/**
	 * Company id for WDA server-to-server history queries, e.g. `it_w123123`.
	 * Unused by call-log sync, which now runs against the WMS CallHistory endpoints.
	 * Kept for backwards compatibility with existing configs.
	 */
	company?: string

	/**
	 * WDA (Wildix Data Analytics) environment for the history client.
	 * Unused by call-log sync since it moved to WMS CallHistory. Kept for compatibility.
	 * @default 'prod'
	 */
	wdaEnv?: 'stage' | 'stable' | 'prod'
}

/** Normalized call status stored on `call-logs`, aligned with the sipgate plugin schema. */
export type CallStatus = 'ringing' | 'connected' | 'completed' | 'missed' | 'voicemail' | 'rejected'

/** Normalized call direction stored on `call-logs`. */
export type CallType = 'in' | 'out'

/**
 * Wildix webhook event names. Wildix delivers deeply structured JSON payloads via
 * HTTP POST. The exact payload shape is configured per integration in the WMS; the
 * fields below are the subset this plugin relies on and are parsed defensively.
 */
export type WildixWebhookEvent =
	| 'call:start'
	| 'call:live:progress'
	| 'call:update'
	| 'call:completed'

export type WildixWebhookCallData = {
	/** SIP call identifier used to control the call (answer, hold, transfer, hangup). */
	sipCallId?: string
	/** Fallback identifier some payloads use instead of sipCallId. */
	callId?: string
	from?: string
	to?: string
	direction?: string
	/** PBX user id / extension owning the call leg. */
	userId?: string
	userExtension?: string
	answeredAt?: number
	startedAt?: number
}

export type WildixWebhookPayload = {
	event: WildixWebhookEvent
	data?: WildixWebhookCallData
}
