import type {
	NeoCallEvent,
	SipgateChannelEventsParams,
	SipgateChannelEventsResponse,
	SipgateChannelResponse,
} from '../types'
import type { SipgateRestFetch } from './sipgate.rest'

type GetNeoCallHistoryOptions = {
	limit?: number
	/**
	 * Sipgate user id (e.g. `w2`). When set, prefer channels this user owns
	 * (private inbox events are owner-only). If they own none, fall back to
	 * channels they are assigned to and skip 403s quietly.
	 */
	sipgateUserId?: string
}

export const getNeoCallHistory = async (
	rest: SipgateRestFetch,
	params?: GetNeoCallHistoryOptions
): Promise<NeoCallEvent[]> => {
	const channelsResponse = await getChannels(rest)
	let channels = channelsResponse.items
	if (params?.sipgateUserId) {
		const owned = channelsResponse.items.filter((channel) => channel.owner === params.sipgateUserId)
		channels =
			owned.length > 0
				? owned
				: channelsResponse.items.filter((channel) =>
						channel.users.some((u) => u.id === params.sipgateUserId)
					)
	}

	const eventParams = params?.limit != null ? { limit: params.limit } : undefined

	const allEvents = await Promise.all(
		channels.map(async (channel) => {
			try {
				const eventsResponse = await getChannelEvents(rest, channel.id, eventParams)
				return eventsResponse.events.filter((event) => event.type === 'CALL')
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				// Private-channel inboxes are owner-only; members get 403. Expected, not a hard failure.
				if (message.includes('403')) {
					console.debug(`[sipgate] Skipping channel ${channel.id} (no inbox access for this token)`)
				} else {
					console.warn(`[sipgate] Skipping channel ${channel.id}:`, err)
				}
				return []
			}
		})
	)

	return allEvents.flat()
}

export const getChannels = async (rest: SipgateRestFetch) => {
	const response = await rest('/channels', { method: 'GET' })
	if (!response.ok) {
		const body = await response.text().catch(() => '')
		throw new Error(`Failed to get channels: ${response.status} ${response.statusText} - ${body}`)
	}
	return (await response.json()) as SipgateChannelResponse
}

export const getChannelEvents = async (
	rest: SipgateRestFetch,
	channelId: string,
	params?: SipgateChannelEventsParams
) => {
	const query = new URLSearchParams()
	if (params) {
		if (params.position) query.append('position', params.position)
		if (params.limit !== undefined) query.append('limit', params.limit.toString())
	}

	const queryString = query.toString()
	const endpoint = queryString
		? `/channels/${channelId}/events?${queryString}`
		: `/channels/${channelId}/events`

	const response = await rest(endpoint, { method: 'GET' })
	if (!response.ok) {
		const body = await response.text().catch(() => '')
		throw new Error(
			`Failed to get channel events: ${response.status} ${response.statusText} - ${body}`
		)
	}
	return (await response.json()) as SipgateChannelEventsResponse
}

export type NeoDialProps = {
	additionalDevices: Array<{
		deviceId: string
	}>
	callerId: string
	channelId: string
	deviceId: string
	targetNumber: string
}

export const NeoDial = async (rest: SipgateRestFetch, props: NeoDialProps) => {
	return rest('/calls', { method: 'POST', body: JSON.stringify(props) })
}
