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
			const eventsResponse = await getChannelEvents(channel.id)
			return eventsResponse.events.filter((event) => event.type === 'CALL')
		})
	)

	return allEvents.flat()
}

export const getChannels = async () => {
	const response = await sipgateRest('/channels', { method: 'GET' })
	if (!response.ok) {
		throw new Error('Failed to get channels')
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
		throw new Error('Failed to get channel events')
	}
	return (await response.json()) as SipgateChannelEventsResponse
}
