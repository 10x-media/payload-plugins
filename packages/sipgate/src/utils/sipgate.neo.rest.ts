import type {
	SipgateChannelEventsParams,
	SipgateChannelEventsResponse,
	SipgateChannelResponse,
} from '../types'
import type { SipgateRestFetch } from './sipgate.rest'

export const getNeoCallHistory = async (rest: SipgateRestFetch) => {
	const channelsResponse = await getChannels(rest)

	const allEvents = await Promise.all(
		channelsResponse.items.map(async (channel) => {
			try {
				const eventsResponse = await getChannelEvents(rest, channel.id)
				return eventsResponse.events.filter((event) => event.type === 'CALL')
			} catch (err) {
				console.warn(`[sipgate] Skipping channel ${channel.id}:`, err)
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

export type SigpateNeoNewChannelResponse = {
	callSid: string
}

export const NeoDial = async (rest: SipgateRestFetch, props: NeoDialProps) => {
	return rest('/calls', { method: 'POST', body: JSON.stringify(props) })
}
