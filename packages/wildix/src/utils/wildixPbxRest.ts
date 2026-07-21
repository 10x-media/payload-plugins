import { env } from '../env'
import type { WildixCredentials } from '../types'

const resolveHost = (credentials: WildixCredentials): string => {
	const host = credentials.pbxHost ?? env.WILDIX_PBX_HOST
	if (!host) {
		throw new Error('Wildix credentials: pbxHost is required for PBX REST calls')
	}
	return host.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

const resolvePort = (credentials: WildixCredentials): number => {
	if (credentials.port != null) return credentials.port
	const fromEnv = env.WILDIX_PBX_PORT
	return fromEnv ? Number(fromEnv) : 443
}

/**
 * Resolves the Bearer token for a PBX REST call. An explicit `tokenOverride`
 * (a user's OAuth2 access token) wins; otherwise the static apiKey is used.
 */
export const resolvePbxToken = (credentials: WildixCredentials, tokenOverride?: string): string => {
	if (tokenOverride) return tokenOverride
	const apiKey = credentials.apiKey ?? env.WILDIX_API_KEY
	if (!apiKey) {
		throw new Error('Wildix credentials: apiKey (or a user access token) is required for PBX REST')
	}
	return apiKey
}

export const buildPbxBaseUrl = (credentials: WildixCredentials): string => {
	const host = resolveHost(credentials)
	const port = resolvePort(credentials)
	const portSuffix = port === 443 ? '' : `:${port}`
	return `https://${host}${portSuffix}`
}

type PbxListResponse<T> = {
	type?: string
	result?: { total?: number; records?: T[] }
	reason?: string
}

/** Fetches a WMS list endpoint and returns its `result.records`, throwing on non-2xx. */
export const fetchPbxRecords = async <T>(url: string, token: string): Promise<T[]> => {
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/json',
		},
	})
	const body = (await response.json()) as PbxListResponse<T>
	if (!response.ok) {
		throw new Error(
			`Wildix PBX request failed: ${response.status} ${body.reason ?? JSON.stringify(body)}`
		)
	}
	return body.result?.records ?? []
}

export type PbxDeviceRecord = {
	id: number | string
	mac?: string
	model?: string
	description?: string
	firmware?: string
	user?: string
	address?: string
	state?: string
	vendor?: { name?: string; additional?: string }
}

export type NormalizedPbxDevice = {
	wildixId: string
	contact: string
	userAgent: string
	online: boolean
	/** PBX extension the device is assigned to, used to link a `wildix-users` doc. */
	extension?: string
}

type FetchDevicesOptions = {
	credentials: WildixCredentials
	token?: string
	count?: number
	start?: number
}

/** Admin: device inventory. `GET /api/v1/Devices/` */
export const fetchPbxDevices = async ({
	credentials,
	token,
	count = 500,
	start = 0,
}: FetchDevicesOptions): Promise<PbxDeviceRecord[]> => {
	const params = new URLSearchParams({ count: String(count), start: String(start) })
	const url = `${buildPbxBaseUrl(credentials)}/api/v1/Devices/?${params}`
	return fetchPbxRecords<PbxDeviceRecord>(url, resolvePbxToken(credentials, token))
}

/** Maps a WMS device record into the `wildix-devices` collection shape. */
export const normalizePbxDevice = (record: PbxDeviceRecord): NormalizedPbxDevice | null => {
	if (record.id == null) return null
	const wildixId = String(record.id)
	const mac = record.mac?.trim()
	const contact = mac && mac.length > 0 ? mac : wildixId
	const userAgent = [record.model, record.vendor?.name, record.description]
		.map((part) => part?.trim())
		.filter((part): part is string => !!part && part.length > 0)
		.join(' - ')
	const extension = record.user ? String(record.user).trim() : undefined
	return {
		wildixId,
		contact,
		userAgent: userAgent.length > 0 ? userAgent : contact,
		online: (record.state ?? '').toLowerCase() === 'on',
		extension: extension && extension.length > 0 ? extension : undefined,
	}
}

export type PbxSipRegistration = {
	online?: string
	contact?: string
	received?: string
	instance?: string
	useragent?: string
}

export type PbxSipRegistrationsByExtension = Record<
	string,
	{ registrations?: PbxSipRegistration[] }
>

type FetchSipRegistrationsOptions = {
	credentials: WildixCredentials
	token?: string
	/** Comma-separated extensions; omit for all users. */
	extensions?: string
}

/**
 * Live SIP proxy registrations (softphones / WebRTC).
 * `GET /api/v1/PBX/Users/Sip/Registrations` or
 * `GET /api/v1/PBX/Users/{extensions}/Sip/Registrations`
 */
export const fetchPbxSipRegistrations = async ({
	credentials,
	token,
	extensions,
}: FetchSipRegistrationsOptions): Promise<PbxSipRegistrationsByExtension> => {
	const path = extensions
		? `/api/v1/PBX/Users/${encodeURIComponent(extensions)}/Sip/Registrations`
		: '/api/v1/PBX/Users/Sip/Registrations'
	const url = `${buildPbxBaseUrl(credentials)}${path}`
	const bearer = resolvePbxToken(credentials, token)
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${bearer}`,
			Accept: 'application/json',
		},
	})
	const body = (await response.json()) as {
		type?: string
		result?: PbxSipRegistrationsByExtension
		reason?: string
	}
	if (!response.ok) {
		throw new Error(
			`Wildix PBX SIP registrations failed: ${response.status} ${body.reason ?? JSON.stringify(body)}`
		)
	}
	return body.result ?? {}
}

/** Maps one SIP registration into the `wildix-devices` collection shape. */
export const normalizePbxSipRegistration = (
	extension: string,
	registration: PbxSipRegistration
): NormalizedPbxDevice | null => {
	const contact = registration.contact?.trim()
	if (!contact) return null
	const instance = registration.instance?.replace(/^<|>$/g, '').trim()
	const wildixId = `sip:${extension}:${instance && instance.length > 0 ? instance : contact}`
	const userAgent = registration.useragent?.trim()
	return {
		wildixId,
		contact,
		userAgent: userAgent && userAgent.length > 0 ? userAgent : contact,
		online: registration.online === '1',
		extension,
	}
}

/** Flattens the SIP registrations map into normalized device rows. */
export const normalizePbxSipRegistrations = (
	byExtension: PbxSipRegistrationsByExtension
): NormalizedPbxDevice[] => {
	const devices: NormalizedPbxDevice[] = []
	for (const [extension, entry] of Object.entries(byExtension)) {
		for (const registration of entry.registrations ?? []) {
			const device = normalizePbxSipRegistration(extension, registration)
			if (device) devices.push(device)
		}
	}
	return devices
}

export type PbxContactRecord = {
	id?: string
	name?: string
	extension?: string
	phone?: string
	office?: string
	mobile?: string
	home?: string
	home_mobile?: string
}

export type NormalizedContact = { name: string; phone: string }

type FetchContactsOptions = {
	credentials: WildixCredentials
	token?: string
	/** Page size per request; the endpoint reports `result.total` for paging. */
	pageSize?: number
	/** Hard cap on records fetched, to bound very large phonebooks. */
	max?: number
}

type PbxContactsResponse = {
	type?: string
	result?: { total?: number; records?: PbxContactRecord[] }
	reason?: string
}

/**
 * Phonebook contacts. `GET /api/v1/Contacts/` (no SDK command in this version).
 * Pages through `result.total` and returns the raw records.
 */
export const fetchPbxContacts = async ({
	credentials,
	token,
	pageSize = 200,
	max = 5000,
}: FetchContactsOptions): Promise<PbxContactRecord[]> => {
	const base = buildPbxBaseUrl(credentials)
	const bearer = resolvePbxToken(credentials, token)
	const records: PbxContactRecord[] = []
	let start = 0
	let total = Number.POSITIVE_INFINITY
	while (start < total && records.length < max) {
		const params = new URLSearchParams({ count: String(pageSize), start: String(start) })
		const response = await fetch(`${base}/api/v1/Contacts/?${params}`, {
			headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
		})
		const body = (await response.json()) as PbxContactsResponse
		if (!response.ok) {
			throw new Error(
				`Wildix PBX contacts failed: ${response.status} ${body.reason ?? JSON.stringify(body)}`
			)
		}
		const page = body.result?.records ?? []
		records.push(...page)
		total = body.result?.total ?? records.length
		if (page.length === 0) break
		start += page.length
	}
	return records
}

const CONTACT_NUMBER_FIELDS = [
	'phone',
	'office',
	'mobile',
	'home',
	'home_mobile',
	'extension',
] as const satisfies readonly (keyof PbxContactRecord)[]

/**
 * Expands contact records into `{ name, phone }` entries, one per non-empty
 * number field, de-duplicated by phone number so a Contact Match lookup is
 * unambiguous.
 */
export const normalizePbxContacts = (records: PbxContactRecord[]): NormalizedContact[] => {
	const byPhone = new Map<string, NormalizedContact>()
	for (const record of records) {
		const name = record.name?.trim()
		if (!name) continue
		for (const field of CONTACT_NUMBER_FIELDS) {
			const phone = record[field]?.trim()
			if (!phone) continue
			if (!byPhone.has(phone)) byPhone.set(phone, { name, phone })
		}
	}
	return [...byPhone.values()]
}
