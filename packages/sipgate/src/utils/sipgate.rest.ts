import { env } from '../env'
import type {
	NeoCallEvent,
	SipgateContact,
	SipgateHistoryParams,
	SipgateHistoryResponse,
} from '../types'
import { ClassicDial, getClassicCallHistory } from './sipgate.classic.rest'
import { getChannels, getNeoCallHistory, NeoDial, type NeoDialProps } from './sipgate.neo.rest'
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
				'Content-Type': 'application/json',
				...(options.headers as Record<string, string> | undefined),
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

export const getCallHistory = async (
	params?: SipgateHistoryParams
): Promise<SipgateHistoryResponse | NeoCallEvent[]> => {
	if (isNeo()) {
		return await getNeoCallHistory()
	}
	return await getClassicCallHistory(params)
}

export type SipgateDialProps = {
	callee: string
	caller: string
	callerId: string
	deviceId?: string
	channelId?: string
}

export const Dial = async (props: SipgateDialProps) => {
	const mode = isNeo() ? 'neo' : 'classic'
	if (mode === 'neo') {
		if (!props.deviceId) {
			throw new Error('Device ID is required for neo calls')
		}
		if (!props.channelId) {
			throw new Error('Channel ID is required for neo calls')
		}
		const neoProps: NeoDialProps = {
			additionalDevices: [],
			callerId: props.callerId,
			channelId: props.channelId,
			deviceId: props.deviceId,
			targetNumber: props.callee,
		}
		return await NeoDial(neoProps)
	}
	return await ClassicDial(props)
}
