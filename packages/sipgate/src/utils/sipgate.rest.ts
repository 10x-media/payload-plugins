import { env } from '../env'
import type {
	NeoCallEvent,
	SipgateContact,
	SipgateHistoryParams,
	SipgateHistoryResponse,
} from '../types'
import { ClassicDial, getClassicCallHistory } from './sipgate.classic.rest'
import { getNeoCallHistory, NeoDial, type NeoDialProps } from './sipgate.neo.rest'
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

type SipgateTransferCallProps = {
	attended: boolean
	callerId: string
	phoneNumber: string
}

export const transferCall = async (callId: string, props: SipgateTransferCallProps) => {
	return await sipgateRest(`/calls/${callId}/transfer`, {
		method: 'POST',
		body: JSON.stringify(props),
	})
}

export const hangupCall = async (callId: string) => {
	return await sipgateRest(`/calls/${callId}`, { method: 'DELETE' })
}

// endpoints for rtcm
type SipgateHoldCallProps = {
	value: boolean
}

export const holdCall = async (callId: string, props: SipgateHoldCallProps) => {
	const response = await sipgateRest(`/calls/${callId}/hold`, {
		method: 'PUT',
		body: JSON.stringify(props),
	})
	if (!response.ok) {
		throw new Error('Failed to hold call')
	}
	return response.json()
}

type SipgateMuteCallProps = {
	value: boolean
}

export const muteCall = async (callId: string, props: SipgateMuteCallProps) => {
	const response = await sipgateRest(`/calls/${callId}/muted`, {
		method: 'PUT',
		body: JSON.stringify(props),
	})
	if (!response.ok) {
		throw new Error('Failed to mute call')
	}
	return response.json()
}

type SipgateRecordingsCallProps = {
	announcement: boolean
	value: boolean
}

export const recordingsCall = async (callId: string, props: SipgateRecordingsCallProps) => {
	const response = await sipgateRest(`/calls/${callId}/recording`, {
		method: 'PUT',
		body: JSON.stringify(props),
	})
	if (!response.ok) {
		throw new Error('Failed to start recording')
	}
	return response.json()
}
