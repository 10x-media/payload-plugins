import { env } from '../env'
import type {
	NeoCallEvent,
	SipgateContact,
	SipgateCredentials,
	SipgateHistoryParams,
	SipgateHistoryResponse,
} from '../types'
import { ClassicDial, getClassicCallHistory } from './sipgate.classic.rest'
import { getNeoCallHistory, NeoDial, type NeoDialProps } from './sipgate.neo.rest'
import { isNeo } from './sipgate.utils'

const BASE_URL = 'https://api.sipgate.com/v2'

export type SipgateRestFetch = (url: string, options: RequestInit) => Promise<Response>

export const buildSipgateRest = (credentials: SipgateCredentials): SipgateRestFetch => {
	const tokenId = credentials.tokenId ?? env.SIPGATE_TOKEN_ID
	const token = credentials.token ?? env.SIPGATE_TOKEN
	if (!tokenId || !token) {
		throw new Error(
			'Sipgate credentials: tokenId and token are required (or set SIPGATE_TOKEN_ID / SIPGATE_TOKEN)'
		)
	}
	const auth = Buffer.from(`${tokenId}:${token}`).toString('base64')
	return (url, options) =>
		fetch(BASE_URL + url, {
			...options,
			headers: {
				'Content-Type': 'application/json',
				...(options.headers as Record<string, string> | undefined),
				Authorization: `Basic ${auth}`,
			},
		})
}

/** @note Works only with OAuth2 tokens that include the userinfo scope. */
type SipgateUserInfo = {
	domain: string
	locale: string
	masterSipId: string
	sub: string
}

export const getUserInfo = async (rest: SipgateRestFetch) => {
	const response = await rest('/authorization/user', { method: 'GET' })
	if (!response.ok) {
		throw new Error('Failed to get user info')
	}
	return (await response.json()) as SipgateUserInfo
}

export const getContacts = async (rest: SipgateRestFetch) => {
	const response = await rest('/contacts', { method: 'GET' })
	if (!response.ok) {
		throw new Error('Failed to get contacts')
	}
	return (await response.json()) as SipgateContact
}

export const getCallHistory = async (
	rest: SipgateRestFetch,
	params?: SipgateHistoryParams
): Promise<SipgateHistoryResponse | NeoCallEvent[]> => {
	if (isNeo()) {
		return getNeoCallHistory(rest)
	}
	return getClassicCallHistory(rest, params)
}

export type SipgateDialProps = {
	callee: string
	caller: string
	callerId: string
	deviceId?: string
	channelId?: string
}

export const Dial = async (rest: SipgateRestFetch, props: SipgateDialProps) => {
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
		return NeoDial(rest, neoProps)
	}
	return ClassicDial(rest, props)
}

type SipgateTransferCallProps = {
	attended: boolean
	callerId: string
	phoneNumber: string
}

export const transferCall = async (
	rest: SipgateRestFetch,
	callId: string,
	props: SipgateTransferCallProps
) => {
	return rest(`/calls/${callId}/transfer`, {
		method: 'POST',
		body: JSON.stringify(props),
	})
}

export const hangupCall = async (rest: SipgateRestFetch, callId: string) => {
	return rest(`/calls/${callId}`, { method: 'DELETE' })
}

export const answerCall = async (rest: SipgateRestFetch, callId: string, deviceId: string) => {
	const response = await rest(`/calls/${callId}/answer`, {
		method: 'PUT',
		body: JSON.stringify({ deviceId }),
	})
	if (!response.ok) {
		throw new Error('Failed to answer call')
	}
	return response
}

type SipgateHoldCallProps = {
	value: boolean
}

export const holdCall = async (
	rest: SipgateRestFetch,
	callId: string,
	props: SipgateHoldCallProps
) => {
	const response = await rest(`/calls/${callId}/hold`, {
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

export const muteCall = async (
	rest: SipgateRestFetch,
	callId: string,
	props: SipgateMuteCallProps
) => {
	const response = await rest(`/calls/${callId}/muted`, {
		method: 'PUT',
		body: JSON.stringify(props),
	})
	if (!response.ok) {
		const body = await response.text().catch(() => '')
		throw new Error(`Failed to mute call: ${response.status} ${response.statusText} - ${body}`)
	}
	return response
}

type SipgateRecordingsCallProps = {
	announcement: boolean
	value: boolean
}

export const recordingsCall = async (
	rest: SipgateRestFetch,
	callId: string,
	props: SipgateRecordingsCallProps
) => {
	const response = await rest(`/calls/${callId}/recording`, {
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
	sipgateUserId: string
	sipgateUser: string
	type: 'REGISTER' | 'MOBILE' | 'EXTERNAL' | 'WEBRTC' | 'CLINQ' | string
	online: boolean
	dnd: boolean
	activeGroups: { id: string; alias: string }[]
	activePhonelines: { id: string; alias: string }[]
	registered?: { userAgent: string; ip: string; port: string }[]
}

export type SipgateUserApiItem = {
	id: string
	firstname: string
	lastname: string
	email: string
	defaultDevice: string
	admin: boolean
	busyOnBusy: boolean
	timezone: string
	addressId: string
}

export type SipgateGroupSettings = {
	greetingAudioFileId?: string
	queue?: { respectWaitingTime: boolean; waitingAudioFileId?: string }
	ringingOrder?: { type: string; users: string[] }
	smsSim?: string
	users?: { followUpTime: number; ringTime: number }
	voiceboxAccessNumber?: number
}

export type SipgateGroupApiItem = {
	id: string
	name: string
	owner: string
	createdAt: string
	locale: string
	settings: SipgateGroupSettings
	users: { id: string; deviceIds: string[] }[]
}

export const getUsers = async (rest: SipgateRestFetch): Promise<SipgateUserApiItem[]> => {
	const response = await rest('/users', { method: 'GET' })
	if (!response.ok) throw new Error('Failed to get users')
	const data = (await response.json()) as { items: SipgateUserApiItem[] }
	return data.items
}

export const getGroups = async (rest: SipgateRestFetch): Promise<SipgateGroupApiItem[]> => {
	const response = await rest('/channels', { method: 'GET' })
	if (!response.ok) throw new Error('Failed to get channels')
	const data = (await response.json()) as { items: SipgateGroupApiItem[] }
	return data.items
}

/**
 * Probes /devices/e0, /devices/e1, ... until 404 or maxCount is reached.
 * Sipgate does not expose CLINQ/web-app devices via /{userId}/devices,
 * so sequential probing is the only reliable discovery mechanism.
 */
export const probeDevices = async (
	rest: SipgateRestFetch,
	maxCount = 25
): Promise<SipgateDevice[]> => {
	const devices: SipgateDevice[] = []
	for (let i = 0; i < maxCount; i++) {
		const response = await rest(`/devices/e${i}`, { method: 'GET' })
		if (response.status === 404) break
		if (response.ok) {
			devices.push((await response.json()) as SipgateDevice)
		}
	}
	return devices
}

export const getDevices = async (
	rest: SipgateRestFetch,
	userId: string
): Promise<SipgateDevice[]> => {
	const response = await rest(`/${userId}/devices`, { method: 'GET' })
	if (!response.ok) {
		throw new Error('Failed to get devices')
	}
	const data = (await response.json()) as { items: SipgateDevice[] }
	return data.items ?? []
}
