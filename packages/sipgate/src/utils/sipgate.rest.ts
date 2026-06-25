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

// will work ONLY with OAuth2
type SipgateUserInfo = {
	domain: string
	locale: string
	masterSipId: string
	sub: string // w0, w1, w2, etc.
}

export const getUserInfo = async () => {
	const response = await sipgateRest('/authorization/user', { method: 'GET' })
	if (!response.ok) {
		throw new Error('Failed to get user info')
	}
	return (await response.json()) as SipgateUserInfo
}

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

export const answerCall = async (callId: string, deviceId: string) => {
	const response = await sipgateRest(`/calls/${callId}/answer`, {
		method: 'PUT',
		body: JSON.stringify({ deviceId }),
	})
	if (!response.ok) {
		throw new Error('Failed to answer call')
	}
	return response
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
	return response
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
		const body = await response.text().catch(() => '')
		throw new Error(`Failed to mute call: ${response.status} ${response.statusText} – ${body}`)
	}
	return response
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
	return response
}

export type SipgateDevice = {
	id: string
	alias: string
	type: 'REGISTER' | 'MOBILE' | 'EXTERNAL'
	online: boolean
	dnd: boolean
	registered: { userAgent: string; ip: string; port: string }[]
}

/**
 * Probes /devices/e0, /devices/e1, ... until 404 or maxCount is reached.
 * Sipgate does not expose CLINQ/web-app devices via /{userId}/devices,
 * so sequential probing is the only reliable discovery mechanism.
 */
export const probeDevices = async (maxCount = 25): Promise<SipgateDevice[]> => {
	const devices: SipgateDevice[] = []
	for (let i = 0; i < maxCount; i++) {
		const response = await sipgateRest(`/devices/e${i}`, { method: 'GET' })
		if (response.status === 404) break
		if (response.ok) {
			devices.push((await response.json()) as SipgateDevice)
		}
	}
	return devices
}

export const getDevices = async (userId: string) => {
	const response = await sipgateRest(`/${userId}/devices`, { method: 'GET' })
	if (!response.ok) {
		throw new Error('Failed to get devices')
	}
	return (await response.json()) as SipgateDevice[]
}
