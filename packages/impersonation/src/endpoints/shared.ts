import {
	addDataAndFileToRequest,
	headersWithCors,
	type PayloadRequest,
	type TypedUser,
} from 'payload'

import { isJsonContentType, verifyMutationOrigin } from '../auth/origin'
import { getRegistry } from '../plugin/registry'
import { asAuthUser, type FailureCode, type ResolvedOptions } from '../types'

export const NO_STORE = { 'Cache-Control': 'no-store' }

export const json = ({
	body,
	cookies = [],
	req,
	status,
}: {
	body: unknown
	cookies?: string[]
	req: PayloadRequest
	status: number
}): Response => {
	const headers = headersWithCors({ headers: new Headers(NO_STORE), req })
	for (const cookie of cookies) {
		headers.append('Set-Cookie', cookie)
	}
	return Response.json(body, { headers, status })
}

export const fail = ({
	cookies,
	error,
	req,
	status,
}: {
	cookies?: string[]
	error: FailureCode
	req: PayloadRequest
	status: number
}): Response => json({ body: { error }, cookies, req, status })

export const rejectGate = (req: PayloadRequest, gate: FailureCode): Response =>
	fail({ error: gate, req, status: gate === 'invalidBody' ? 400 : 403 })

export const getOptions = (req: PayloadRequest): ResolvedOptions => {
	const options = getRegistry(req.payload.config)
	if (!options) {
		throw new Error('@10x-media/impersonation: plugin options were not registered')
	}
	return options
}

export const callerSid = (user: null | TypedUser | undefined): string | undefined => {
	if (!user) {
		return undefined
	}
	return asAuthUser(user)._sid
}

export const isApiKeyStrategy = (user: TypedUser): boolean => {
	const strategy = asAuthUser(user)._strategy
	return typeof strategy === 'string' && strategy.endsWith('-api-key')
}

export const prepareMutation = async (req: PayloadRequest): Promise<FailureCode | null> => {
	const options = getOptions(req)
	if (!verifyMutationOrigin({ headers: req.headers, options, payload: req.payload })) {
		return 'origin'
	}
	if (!isJsonContentType(req.headers)) {
		return 'invalidBody'
	}
	await addDataAndFileToRequest(req)
	return null
}

/** Only the literal `true` allows. A Payload `Where` object is deny, never allow-all. */
export const isLiteralTrue = (value: unknown): value is true => value === true

export const safeRedirect = (value: unknown, fallback: string): string => {
	if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
		return fallback
	}
	try {
		if (new URL(value, 'http://x').origin !== 'http://x') {
			return fallback
		}
	} catch {
		return fallback
	}
	return value
}

export const trimReason = (value: unknown, maxLength: number): string | undefined => {
	if (typeof value !== 'string') {
		return undefined
	}
	const trimmed = value.trim().slice(0, maxLength)
	return trimmed.length > 0 ? trimmed : undefined
}

export const defaultRedirect = (req: PayloadRequest, collection: string): string => {
	const adminCollection = req.payload.config.admin.user
	if (collection === adminCollection) {
		return req.payload.config.routes.admin
	}
	return '/'
}
