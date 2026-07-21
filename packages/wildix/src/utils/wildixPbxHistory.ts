import type { CallStatus, CallType, WildixCredentials } from '../types'
import { buildPbxBaseUrl, fetchPbxRecords, resolvePbxToken } from './wildixPbxRest'

export type PbxCallHistoryRecord = {
	id: string
	start?: string
	answer?: string
	end?: string
	src?: string
	dst?: string
	from_number?: string
	to_number?: string
	from_name?: string
	to_name?: string
	billsec?: string
	disposition?: string
	duration?: string
	timezone?: string
	channel?: string
	type?: string
}

export type NormalizedPbxCallLog = {
	callId: string
	callType: CallType
	callStatus: CallStatus
	callDuration: number
	fromNumber: string
	toNumber: string
	startedAt: Date
}

type FetchCallHistoryOptions = {
	credentials: WildixCredentials
	/** OAuth2 access token override; falls back to the static apiKey when absent. */
	token?: string
	count?: number
	start?: number
	dir?: 'ASC' | 'DESC'
}

const CALL_HISTORY_FIELDS = [
	'id',
	'start',
	'answer',
	'end',
	'src',
	'dst',
	'from_number',
	'to_number',
	'from_name',
	'to_name',
	'billsec',
	'disposition',
	'duration',
	'timezone',
	'channel',
	'type',
].join(',')

/** Admin: full PBX call history. `GET /api/v1/PBX/CallHistory/` */
export const fetchPbxCallHistory = async (
	options: FetchCallHistoryOptions
): Promise<PbxCallHistoryRecord[]> => {
	const { credentials, token, count = 100, start = 0, dir = 'DESC' } = options
	const params = new URLSearchParams({
		count: String(count),
		start: String(start),
		dir,
		fields: CALL_HISTORY_FIELDS,
	})
	const url = `${buildPbxBaseUrl(credentials)}/api/v1/PBX/CallHistory/?${params}`
	return fetchPbxRecords<PbxCallHistoryRecord>(url, resolvePbxToken(credentials, token))
}

/** Admin: call history for one extension. `GET /api/v1/User/{extension}/CallHistory/` */
export const fetchUserCallHistory = async (
	options: FetchCallHistoryOptions & { extension: string }
): Promise<PbxCallHistoryRecord[]> => {
	const { credentials, token, extension, count = 100, start = 0, dir = 'DESC' } = options
	const params = new URLSearchParams({
		count: String(count),
		start: String(start),
		dir,
		fields: CALL_HISTORY_FIELDS,
	})
	const url = `${buildPbxBaseUrl(credentials)}/api/v1/User/${encodeURIComponent(extension)}/CallHistory/?${params}`
	return fetchPbxRecords<PbxCallHistoryRecord>(url, resolvePbxToken(credentials, token))
}

const isExtensionLike = (value: string): boolean => /^\d{2,6}$/.test(value)

const mapDisposition = (disposition: string | undefined, billsec: number): CallStatus => {
	const d = (disposition ?? '').toUpperCase()
	if (d === 'BUSY') return 'rejected'
	if (d === 'NO ANSWER' || d === 'FAILED' || d === 'CONGESTION') return 'missed'
	if (d === 'ANSWERED') return billsec > 0 ? 'completed' : 'completed'
	return billsec > 0 ? 'completed' : 'missed'
}

const mapCallType = (record: PbxCallHistoryRecord, extension?: string): CallType => {
	const from = record.from_number ?? record.src ?? ''
	const to = record.to_number ?? record.dst ?? ''
	if (extension) {
		if (from === extension || record.channel?.includes(`SIP/${extension}-`)) return 'out'
		if (to === extension) return 'in'
	}
	if (isExtensionLike(from) && !isExtensionLike(to)) return 'out'
	if (!isExtensionLike(from) && isExtensionLike(to)) return 'in'
	return 'out'
}

const parseStartedAt = (record: PbxCallHistoryRecord): Date => {
	const raw = record.start
	if (!raw) return new Date()
	const tz = record.timezone?.trim()
	const withTz = tz && /^[+-]\d{4}$/.test(tz) ? `${raw}${tz}` : raw
	const parsed = new Date(withTz.replace(' ', 'T'))
	return Number.isNaN(parsed.getTime()) ? new Date(raw) : parsed
}

/** Maps a WMS PBX CallHistory record into the plugin call-log shape. */
export const normalizePbxCallRecord = (
	record: PbxCallHistoryRecord,
	extension?: string
): NormalizedPbxCallLog | null => {
	if (!record.id || record.type === 'fax') return null
	const billsec = Number(record.billsec ?? 0) || 0
	const duration = Number(record.duration ?? 0) || 0
	return {
		callId: record.id,
		callType: mapCallType(record, extension),
		callStatus: mapDisposition(record.disposition, billsec),
		callDuration: billsec > 0 ? billsec : duration,
		fromNumber: record.from_number ?? record.src ?? '',
		toNumber: record.to_number ?? record.dst ?? '',
		startedAt: parseStartedAt(record),
	}
}

export const normalizePbxCallHistory = (
	records: PbxCallHistoryRecord[],
	extension?: string
): NormalizedPbxCallLog[] =>
	records.flatMap((record) => {
		const entry = normalizePbxCallRecord(record, extension)
		return entry ? [entry] : []
	})
