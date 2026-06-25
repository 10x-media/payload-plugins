import type {
	SipgateChannelEventsParams,
	SipgateChannelEventsResponse,
	SipgateChannelResponse,
} from '../types'
import { sipgateRest } from './sipgate.rest'

export const getNeoCallHistory = async () => {
	const channelsResponse = await getChannels()

	const allEvents = await Promise.all(
		channelsResponse.items.map(async (channel) => {
			try {
				const eventsResponse = await getChannelEvents(channel.id)
				return eventsResponse.events.filter((event) => event.type === 'CALL')
			} catch (err) {
				console.warn(`[sipgate] Skipping channel ${channel.id}:`, err)
				return []
			}
		})
	)

	return allEvents.flat()
}

export const getChannels = async () => {
	const response = await sipgateRest('/channels', { method: 'GET' })
	if (!response.ok) {
		const body = await response.text().catch(() => '')
		throw new Error(`Failed to get channels: ${response.status} ${response.statusText} - ${body}`)
	}
	return (await response.json()) as SipgateChannelResponse
}

export const getChannelEvents = async (channelId: string, params?: SipgateChannelEventsParams) => {
	const query = new URLSearchParams()
	if (params) {
		if (params.position) query.append('position', params.position)
		if (params.limit !== undefined) query.append('limit', params.limit.toString())
	}

	const queryString = query.toString()
	const endpoint = queryString
		? `/channels/${channelId}/events?${queryString}`
		: `/channels/${channelId}/events`

	const response = await sipgateRest(endpoint, { method: 'GET' })
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

export const NeoDial = async (props: NeoDialProps) => {
	const response = await sipgateRest('/calls', { method: 'POST', body: JSON.stringify(props) })
	return response
}
