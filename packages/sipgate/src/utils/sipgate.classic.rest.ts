import type { SipgateHistoryParams, SipgateHistoryResponse } from '../types'
import { sipgateRest } from './sipgate.rest'

export const getClassicCallHistory = async (params?: SipgateHistoryParams) => {
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
		if (params.starred)
			params.starred.forEach((star) => {
				query.append('starred', star)
			})
		if (params.from) query.append('from', params.from)
		if (params.to) query.append('to', params.to)
		if (params.phonenumber) query.append('phonenumber', params.phonenumber)
	}

	const queryString = query.toString()
	const endpoint = queryString ? `/history?${queryString}` : '/history'

	const response = await sipgateRest(endpoint, { method: 'GET' })
	if (!response.ok) {
		throw new Error('Failed to get call history')
	}
	return (await response.json()) as SipgateHistoryResponse
}
