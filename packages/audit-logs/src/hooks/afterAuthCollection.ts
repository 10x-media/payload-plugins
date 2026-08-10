import type { CollectionAfterForgotPasswordHook, CollectionAfterLoginHook } from 'payload'

import { getClientIP, getUserAgent } from '../utilities/request'

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

		await req.payload.create({
			collection: 'audit-logs',
			data: {
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
			},
			overrideAccess: true,
		})
	}

export const afterForgotPasswordAuditLog =
	(options: AuthAuditOptions): CollectionAfterForgotPasswordHook =>
	async ({ args }) => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { req, data } = args as any
		if (!req) return

		const ipAddress = options.collectIpAddress ? getClientIP(req) : undefined
		const userAgent = options.collectUserAgent ? getUserAgent(req) : undefined
		const group = options.groupContextKey
			? ((req.context as Record<string, unknown>)?.[options.groupContextKey] as string | undefined)
			: undefined

		await req.payload.create({
			collection: 'audit-logs',
			data: {
				operation: 'auth',
				eventType: 'forgot_password',
				relationTo: options.collectionSlug,
				...(req.locale && { locale: req.locale }),
				payloadAPI: req.payloadAPI,
				...(ipAddress && { ipAddress }),
				...(userAgent && { userAgent }),
				// email logged for security traceability — the account exists since hook fires on success
				metadata: { email: data?.email },
				...(group && { group }),
			},
			overrideAccess: true,
		})
	}
