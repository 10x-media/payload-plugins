import type {
	CollectionAfterErrorHook,
	CollectionAfterForgotPasswordHook,
	CollectionAfterLoginHook,
	PayloadRequest,
} from 'payload'
import { AuthenticationError, LockedAuth, UnverifiedEmail } from 'payload'

import type { FailedLoginOptions, FailedLoginReason } from '../types'
import { getClientIP, getUserAgent } from '../utilities/request'
import { writeAuditLog } from '../utilities/writeAuditLog'

export type AuthAuditOptions = {
	collectionSlug: string
	collectIpAddress: boolean
	fastWrite: boolean
	collectUserAgent: boolean
	groupContextKey?: string
	isUserPolymorphic: boolean
}

/** Nothing an anonymous caller submits reaches a row at full length. */
const MAX_IDENTIFIER_LENGTH = 256

/**
 * Which of Payload's refusals this is, if any.
 *
 * Matched by class, never by `error.name`. `APIError` copies its name off the
 * constructor, and Next minifies the server build, so in production that name arrives
 * mangled (`ac`, and a different letter next release). Class identity survives
 * minification, and `payload` is a peer dependency, so the classes compared here are
 * the ones the host threw.
 */
export const failedLoginReason = (error: unknown): FailedLoginReason | undefined => {
	if (error instanceof AuthenticationError) return 'invalid_credentials'
	if (error instanceof LockedAuth) return 'locked'
	if (error instanceof UnverifiedEmail) return 'unverified'
	return undefined
}

/**
 * `afterError` is attached to the collection, not to one endpoint, and the refusals above
 * are raised by more than one auth route, so the path has to agree before anything is
 * written. The api route prefix is host-configurable, hence the suffix match.
 */
export const isLoginRoute = (req: PayloadRequest): boolean =>
	typeof req.pathname === 'string' && req.pathname.endsWith('/login')

/**
 * The email or username that was tried. Read off `req.data`, which the REST layer fills
 * before the handler runs and which survives into the error path untouched. The password
 * sits in the same object and is deliberately never read.
 */
export const loginIdentifier = (req: PayloadRequest): string | undefined => {
	const data = req.data as { email?: unknown; username?: unknown } | undefined
	const submitted = typeof data?.email === 'string' ? data.email : data?.username
	if (typeof submitted !== 'string' || submitted.length === 0) return undefined
	return submitted.slice(0, MAX_IDENTIFIER_LENGTH)
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

		await writeAuditLog({
			req,
			fastWrite: options.fastWrite,
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

		await writeAuditLog({
			req,
			fastWrite: options.fastWrite,
			data: {
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
			},
		})
	}

/**
 * Records logins Payload refused, so a run of them is visible as a run.
 *
 * The entry carries no user on purpose: Payload answers identically whether the account
 * exists or the password was wrong, so claiming to know who was targeted would be a
 * guess. What it does carry is the submitted identifier, the reason, and the caller's IP.
 *
 * By the time this runs the login operation has already called `killTransaction`, which
 * rolls back and clears `req.transactionID`, so the entry is written outside the
 * transaction that failed and cannot be rolled back with it.
 */
export const afterErrorFailedLoginAuditLog =
	(options: AuthAuditOptions & { failedLogin: FailedLoginOptions }): CollectionAfterErrorHook =>
	async ({ error, req }) => {
		if (!isLoginRoute(req)) return
		const reason = failedLoginReason(error)
		if (!reason) return

		const identifier = loginIdentifier(req)

		if (options.failedLogin.shouldLog) {
			const allow = await options.failedLogin.shouldLog({ identifier, reason, req })
			if (!allow) return
		}

		const ipAddress = options.collectIpAddress ? getClientIP(req) : undefined
		const userAgent = options.collectUserAgent ? getUserAgent(req) : undefined
		const group = options.groupContextKey
			? ((req.context as Record<string, unknown>)?.[options.groupContextKey] as string | undefined)
			: undefined

		await writeAuditLog({
			req,
			fastWrite: options.fastWrite,
			data: {
				operation: 'auth',
				eventType: 'failed_login',
				relationTo: options.collectionSlug,
				...(req.locale && { locale: req.locale }),
				payloadAPI: req.payloadAPI,
				...(ipAddress && { ipAddress }),
				...(userAgent && { userAgent }),
				metadata: { identifier, reason },
				...(group && { group }),
			},
		})
	}
