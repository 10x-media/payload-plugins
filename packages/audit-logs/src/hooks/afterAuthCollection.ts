import type {
	CollectionAfterForgotPasswordHook,
	CollectionAfterLoginHook,
	PayloadRequest,
} from 'payload'

import { getClientIP, getUserAgent } from '../utilities/request'
import { writeAuditLog } from '../utilities/writeAuditLog'

export type AuthAuditOptions = {
	collectionSlug: string
	collectIpAddress: boolean
	collectUserAgent: boolean
	groupContextKey?: string
	isUserPolymorphic: boolean
}

export const afterLoginAuditLog =
	(options: AuthAuditOptions): CollectionAfterLoginHook =>
	async ({ req, user }) => {
		const userValue = options.isUserPolymorphic
			? { relationTo: options.collectionSlug, value: user.id }
			: user.id

		const ipAddress = options.collectIpAddress ? getClientIP(req) : undefined
		const userAgent = options.collectUserAgent ? getUserAgent(req) : undefined
		const group = options.groupContextKey
			? ((req.context as Record<string, unknown>)?.[options.groupContextKey] as string | undefined)
			: undefined

		await writeAuditLog(req, {
			operation: 'auth',
			eventType: 'login',
			relationTo: options.collectionSlug,
			documentId: String(user.id),
			user: userValue,
			...(req.locale && { locale: req.locale }),
			payloadAPI: req.payloadAPI,
			...(ipAddress && { ipAddress }),
			...(userAgent && { userAgent }),
			...(group && { group }),
		})
	}

export const afterForgotPasswordAuditLog =
	(options: AuthAuditOptions): CollectionAfterForgotPasswordHook =>
	async ({ args }) => {
		// Payload types `args` loosely for this hook; only `req` and the submitted email are read.
		const { req, data } = args as {
			data?: { email?: string }
			req?: PayloadRequest
		}
		if (!req) return

		const ipAddress = options.collectIpAddress ? getClientIP(req) : undefined
		const userAgent = options.collectUserAgent ? getUserAgent(req) : undefined
		const group = options.groupContextKey
			? ((req.context as Record<string, unknown>)?.[options.groupContextKey] as string | undefined)
			: undefined

		await writeAuditLog(req, {
			operation: 'auth',
			eventType: 'forgot_password',
			relationTo: options.collectionSlug,
			...(req.locale && { locale: req.locale }),
			payloadAPI: req.payloadAPI,
			...(ipAddress && { ipAddress }),
			...(userAgent && { userAgent }),
			// The hook only fires for an existing account, so storing the email cannot enumerate addresses.
			metadata: { email: data?.email },
			...(group && { group }),
		})
	}
