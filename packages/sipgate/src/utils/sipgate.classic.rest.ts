import type { SipgateHistoryParams, SipgateHistoryResponse } from '../types'
import type { SipgateRestFetch } from './sipgate.rest'

export const getClassicCallHistory = async (
	rest: SipgateRestFetch,
	params?: SipgateHistoryParams
) => {
	const query = new URLSearchParams()
	if (params) {
		if (params.connectionIds)
			params.connectionIds.forEach((id) => {
				query.append('connectionIds', id)
			})
		if (params.types)
			params.types.forEach((type) => {
				query.append('types', type)
			})
		if (params.directions)
			params.directions.forEach((dir) => {
				query.append('directions', dir)
			})
		if (params.offset !== undefined) query.append('offset', params.offset.toString())
		if (params.limit !== undefined) query.append('limit', params.limit.toString())
		if (params.archived !== undefined) query.append('archived', params.archived.toString())
		if (params.starred) query.append('starred', params.starred.toString())
		if (params.from) query.append('from', params.from)
		if (params.to) query.append('to', params.to)
		if (params.phonenumber) query.append('phonenumber', params.phonenumber)
	}

	const queryString = query.toString()
	const endpoint = queryString ? `/history?${queryString}` : '/history'

	const response = await rest(endpoint, { method: 'GET' })
	if (!response.ok) {
		throw new Error('Failed to get call history')
	}
	return (await response.json()) as SipgateHistoryResponse
}

export type SipgateNewSessionProps = {
	callee: string
	caller: string
	callerId: string
	deviceId?: string
}

export type SipgateNewSessionResponse = {
	sessionId: string
}

export const ClassicDial = async (rest: SipgateRestFetch, props: SipgateNewSessionProps) => {
	return rest('/sessions/calls', {
		method: 'POST',
		body: JSON.stringify(props),
	})
}
