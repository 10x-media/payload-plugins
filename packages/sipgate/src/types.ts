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

	/**
	 * Device ID to use as the caller (e.g. `e0`). Sipgate rings this device first, then bridges
	 * to the callee. Find yours at GET /v2/{sub}/devices.
	 */
	deviceId?: string

	/**
	 * Channel ID for sipgate Neo accounts. Required when using the Neo API.
	 */
	channelId?: string

	/**
	 * Outbound caller ID shown to the callee. Defaults to the device's assigned number if omitted.
	 */
	callerId?: string
}

export type SipgateContact = {
	items: Array<{
		addresses: {
			address1: string
			address2: string
			addressId: string
			city: string
			countrycode: string
			emergencyState: string
			number: string
			numbersUrl: string
			postcode: string
			state: string
			street: string
			type: string
		}[]
		emails: {
			email: string
			type: string[]
		}[]
		familyname: string
		givenname: string
		id: string
		name: string
		note: string
		numbers: {
			id: string
			localized: string
			number: string
			type: string
		}[]
		organization: string[][]
		picture: string
		scope: string
		websites: {
			type: string[]
			url: string
		}[]
	}>
	totalCount: number
}

export type SipgateHistoryParams = {
	connectionIds?: string[]
	types?: ('CALL' | 'VOICEMAIL' | 'SMS' | 'FAX')[]
	directions?: ('INCOMING' | 'OUTGOING' | 'MISSED_INCOMING' | 'MISSED_OUTGOING')[]
	offset?: number
	limit?: number
	archived?: boolean
	starred?: boolean
	from?: string
	to?: string
	phonenumber?: string
}

export type SipgateHistoryResponse = {
	items: Array<{
		archived: boolean
		connectionIds: string[]
		created: string
		direction: string
		endpoints: Array<{
			endpoint: {
				extension: string
				type: string
			}
			type: string
		}>
		id: string
		incoming: boolean
		labels: string[]
		lastModified: string
		note: string
		read: boolean
		source: string
		sourceAlias: string
		starred: boolean
		status: string
		target: string
		targetAlias: string
		type: string
	}>
	totalCount: number
}

export type SipgateChannelResponse = {
	items: Array<{
		createdAt: string
		id: string
		locale: string
		name: string
		owner: string
		settings: {
			greetingAudioFileId: string
			queue: {
				respectWaitingTime: boolean
				waitingAudioFileId: string
			}
			ringingOrder: {
				type: string
				users: string[]
			}
			smsSim: string
			users: {
				followUpTime: number
				ringTime: number
			}
			voiceboxAccessNumber: number
		}
		users: Array<{
			deviceIds: string[]
			id: string
		}>
	}>
}

export type SipgateChannelEventsParams = {
	position?: string
	limit?: number
}

export type NeoCallDirection = 'INCOMING' | 'OUTGOING'

export type NeoCallState =
	| 'RINGING'
	| 'ESTABLISHED'
	| 'FINISHED'
	| 'MISSED'
	| 'REJECTED'
	| 'TRANSFERRING'
	| 'TRANSFERRED'
	| 'TRANSFER_FAILED'
	| 'BUSY'
	| 'CLIENT_ERROR'
	| 'UNKNOWN'

export type NeoCallTerminatedReason = 'CANCELLED' | 'TERMINATED' | 'UNKNOWN'

export type SipgateChannelEventsResponse = {
	events: Array<{
		call: {
			callSid: string
			channelId: string
			direction: NeoCallDirection
			establishedAt: string
			forwarding: {
				target: string
				type: string
			}
			from: string
			/** User who conducted the call. Null for missed calls. */
			owner: string | null
			startedAt: string
			state: NeoCallState
			terminatedAt: string
			terminatedReason: NeoCallTerminatedReason
			to: string
		}
		createdAt: string
		eventId: string
		recordings: Array<{
			downloadUrl: string
			type: string
		}>
		type: 'CALL'
	}>
	limit: number
	position: string
}

export type NeoCallEvent = SipgateChannelEventsResponse['events'][0]

export type UnifiedCallHistoryResponse<T extends 'classic' | 'neo'> = T extends 'classic'
	? SipgateHistoryResponse
	: NeoCallEvent[]

export type CallStatus = 'ringing' | 'connected' | 'completed' | 'missed' | 'voicemail' | 'rejected'
