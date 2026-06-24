import { env } from '../env'
import type {
	AcceptCallAndBridgeProps,
	NeoCallEvent,
	SigpateNeoNewChannelResponse,
	SipgateContact,
	SipgateHistoryParams,
	SipgateHistoryResponse,
} from '../types'
import { getClassicCallHistory } from './sipgate.classic.rest'
import { getNeoCallHistory } from './sipgate.neo.rest'
import { isNeo } from './sipgate.utils'

const BASE_URL = 'https://api.sipgate.com/v2'

const buildSecureFetch = (tokenId: string | undefined, token: string | undefined) => {
	if (!tokenId || !token) {
		throw new Error('SIPGATE_TOKEN_ID and SIPGATE_TOKEN must be set')
	}
	const auth = Buffer.from(`${tokenId}:${token}`).toString('base64')

	return async (url: string, options: RequestInit) => {
		const response = await fetch(BASE_URL + url, {
			...options,
			headers: {
				Authorization: `Basic ${auth}`,
			},
		})
		return response
	}
}

export const sipgateRest = buildSecureFetch(env.SIPGATE_TOKEN_ID, env.SIPGATE_TOKEN)

export const getContacts = async () => {
	const response = await sipgateRest('/contacts', { method: 'GET' })
	if (!response.ok) {
		throw new Error('Failed to get contacts')
	}
	return (await response.json()) as SipgateContact
}

export const acceptCallAndBridge = async ({ mode, ...props }: AcceptCallAndBridgeProps) => {
	const endpoint = mode === 'neo' ? '/calls' : '/sessions/calls'
	const response = await sipgateRest(endpoint, {
		method: 'POST',
		body: JSON.stringify(props),
	})
	if (!response.ok) {
		throw new Error('Failed to accept call and bridge')
	}
	return (await response.json()) as SigpateNeoNewChannelResponse
}

export const getCallHistory = async (
	params?: SipgateHistoryParams
): Promise<SipgateHistoryResponse | NeoCallEvent[]> => {
	if (isNeo()) {
		return await getNeoCallHistory()
	}
	return await getClassicCallHistory(params)
}
