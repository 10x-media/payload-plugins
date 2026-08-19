import {
	type AuthCollectionSlug,
	addDataAndFileToRequest,
	addLocalesToRequestFromData,
	type Endpoint,
	headersWithCors,
	loginOperation,
	logoutOperation,
	meOperation,
	type PayloadRequest,
	refreshOperation,
	registerFirstUserOperation,
	resetPasswordOperation,
	sanitizeJoinParams,
	sanitizePopulateParam,
	sanitizeSelectParam,
	type TypedUser,
} from 'payload'
import { isNumber, parseCookies } from 'payload/shared'

import type { ResolvedIsolatedCollection } from '../types'
import { extractAuthorizationToken } from './authorization'
import {
	generateExpiredIsolatedCookie,
	generateIsolatedCookie,
	getSharedCookieName,
	resolveSlotCookieName,
} from './cookies'
import { warnIfAdminMisclassified } from './misclassification'

const getDepth = (req: PayloadRequest) => {
	const depth = req.query.depth ?? req.searchParams.get('depth')
	return isNumber(depth) ? Number(depth) : undefined
}

/**
 * Payload wraps its own auth endpoints with `wrapInternalEndpoints`, which parses the
 * body onto `req.data`. Custom endpoints are not wrapped, so replacements have to do
 * it themselves.
 */
const prepareWrite = async (req: PayloadRequest) => {
	await addDataAndFileToRequest(req)
	addLocalesToRequestFromData(req)
}

const getString = (req: PayloadRequest, key: string) =>
	typeof req.data?.[key] === 'string' ? (req.data[key] as string) : ''

/**
 * The core auth operations type the user they return loosely (`Record<string, unknown>` on
 * some paths, the collection's own doc on others), while `TypedUser` is the union across
 * every auth collection. It is the same object either way.
 */
const asUser = (user: unknown) => user as TypedUser | undefined

/**
 * Replacements for the built-in auth endpoints that read from and write to a
 * collection-scoped cookie. Each one delegates to the same core operation the built-in
 * handler uses, so behaviour (hooks, lockout, sessions, verification) is unchanged.
 * Only the cookie name differs.
 *
 * Payload appends its built-in endpoints *after* the ones declared on the collection,
 * and `handleEndpoints` matches the first entry that fits. Declaring these on the
 * collection therefore shadows the built-ins.
 *
 * Which cookie a handler touches is a question about the user, not about the collection,
 * so every handler that writes one asks {@link resolveSlotCookieName} first. With no
 * `isolate` predicate the answer is always the isolated cookie and these behave exactly as
 * before; with one, the users it rejects are written to the shared cookie in the same bytes
 * core would have written.
 */
export const buildIsolatedAuthEndpoints = ({
	entry,
}: {
	entry: ResolvedIsolatedCollection
}): Endpoint[] => {
	const { slug } = entry

	const getCollection = (req: PayloadRequest) => {
		const collection = req.payload.collections[slug]
		if (!collection) {
			throw new Error(`dualSession: collection "${slug}" is not registered on payload.`)
		}
		return collection
	}

	const slotFor = (req: PayloadRequest, user: null | TypedUser | undefined) =>
		resolveSlotCookieName({
			entry,
			sharedName: getSharedCookieName(req.payload.config.cookiePrefix),
			user,
		})

	return [
		{
			method: 'post',
			path: '/login',
			handler: async (req) => {
				await prepareWrite(req)

				const collection = getCollection(req)
				const authConfig = collection.config.auth

				const data =
					authConfig.loginWithUsername !== false
						? {
								email: getString(req, 'email'),
								password: getString(req, 'password'),
								username: getString(req, 'username'),
							}
						: { email: getString(req, 'email'), password: getString(req, 'password') }

				const result = await loginOperation<AuthCollectionSlug>({
					collection,
					data,
					depth: getDepth(req),
					req,
				})

				const headers = headersWithCors({ headers: new Headers(), req })
				const user = asUser(result.user)
				const name = slotFor(req, user)

				if (result.token && name) {
					headers.set(
						'Set-Cookie',
						generateIsolatedCookie({ authConfig, name, token: result.token })
					)

					await warnIfAdminMisclassified({ collection, cookieName: name, entry, req, user })
				}

				if (authConfig.removeTokenFromResponses) {
					delete result.token
				}

				return Response.json(
					{ message: req.t('authentication:passed'), ...result },
					{ headers, status: 200 }
				)
			},
		},
		{
			method: 'post',
			path: '/logout',
			handler: async (req) => {
				await prepareWrite(req)

				const collection = getCollection(req)
				const headers = headersWithCors({ headers: new Headers(), req })

				const result = await logoutOperation({
					allSessions: req.searchParams.get('allSessions') === 'true',
					collection,
					req,
				})

				if (!result) {
					return Response.json({ message: req.t('error:logoutFailed') }, { headers, status: 400 })
				}

				// `logoutOperation` refuses without a user, so by here `req.user` is this
				// collection's and the slot is always resolvable.
				const name = slotFor(req, req.user)

				if (name) {
					headers.set(
						'Set-Cookie',
						generateExpiredIsolatedCookie({ authConfig: collection.config.auth, name })
					)
				}

				return Response.json(
					{ message: req.t('authentication:logoutSuccessful') },
					{ headers, status: 200 }
				)
			},
		},
		{
			method: 'post',
			path: '/refresh-token',
			handler: async (req) => {
				await prepareWrite(req)

				const collection = getCollection(req)
				const authConfig = collection.config.auth
				const headers = headersWithCors({ headers: new Headers(), req })

				const { refreshedToken, ...result } = await refreshOperation({ collection, req })
				const name = slotFor(req, req.user)

				if (result.setCookie && refreshedToken && name) {
					headers.set(
						'Set-Cookie',
						generateIsolatedCookie({ authConfig, name, token: refreshedToken })
					)
				}

				return Response.json(
					{
						message: req.t('authentication:tokenRefreshSuccessful'),
						...result,
						...(authConfig.removeTokenFromResponses ? {} : { refreshedToken }),
					},
					{ headers, status: 200 }
				)
			},
		},
		{
			method: 'get',
			path: '/me',
			handler: async (req) => {
				const collection = getCollection(req)
				const { joins, populate, select } = req.query as {
					joins?: Parameters<typeof sanitizeJoinParams>[0]
				} & Record<string, unknown>

				// The built-in handler reads the token via `extractJWT`, which only knows about
				// the shared cookie, which would report the admin's token back to a frontend user.
				// With no cookie in this user's slot the request was authenticated by something
				// else (an `Authorization` header, a custom strategy), so fall back to core's own
				// extraction rather than reporting no token at all.
				const slot = slotFor(req, req.user)
				const currentToken =
					(slot ? parseCookies(req.headers).get(slot) : undefined) ??
					extractAuthorizationToken({ headers: req.headers, payload: req.payload })

				const result = await meOperation({
					collection,
					currentToken,
					depth: getDepth(req),
					draft: (req.query.draft ?? req.searchParams.get('draft')) === 'true',
					joins: sanitizeJoinParams(joins),
					populate: sanitizePopulateParam(populate),
					req,
					select: sanitizeSelectParam(select),
				})

				if (collection.config.auth.removeTokenFromResponses) {
					delete result.token
				}

				return Response.json(
					{ ...result, message: req.t('authentication:account') },
					{ headers: headersWithCors({ headers: new Headers(), req }), status: 200 }
				)
			},
		},
		{
			method: 'post',
			path: '/reset-password',
			handler: async (req) => {
				await prepareWrite(req)

				const collection = getCollection(req)
				const authConfig = collection.config.auth

				const result = await resetPasswordOperation({
					collection,
					data: { password: getString(req, 'password'), token: getString(req, 'token') },
					depth: getDepth(req),
					req,
				})

				const headers = headersWithCors({ headers: new Headers(), req })
				const name = slotFor(req, asUser(result.user))

				if (result.token && name) {
					headers.set(
						'Set-Cookie',
						generateIsolatedCookie({ authConfig, name, token: result.token })
					)
				}

				if (authConfig.removeTokenFromResponses) {
					delete result.token
				}

				return Response.json(
					{ message: req.t('authentication:passwordResetSuccessfully'), ...result },
					{ headers, status: 200 }
				)
			},
		},
		{
			method: 'post',
			path: '/first-register',
			handler: async (req) => {
				await prepareWrite(req)

				const collection = getCollection(req)
				const authConfig = collection.config.auth

				const authData =
					authConfig.loginWithUsername !== false
						? {
								email: getString(req, 'email'),
								password: getString(req, 'password'),
								username: getString(req, 'username'),
							}
						: { email: getString(req, 'email'), password: getString(req, 'password') }

				const result = await registerFirstUserOperation({
					collection,
					data: { ...req.data, ...authData },
					req,
				})

				const headers = headersWithCors({ headers: new Headers(), req })

				// The very first user of the collection that backs the admin panel is created to
				// get *into* it, and has no roles yet for a predicate to read, so this one always
				// writes the shared cookie rather than asking.
				const name =
					slug === req.payload.config.admin.user
						? getSharedCookieName(req.payload.config.cookiePrefix)
						: slotFor(req, asUser(result.user))

				if (result.token && name) {
					headers.set(
						'Set-Cookie',
						generateIsolatedCookie({ authConfig, name, token: result.token })
					)
				}

				return Response.json(
					{
						exp: result.exp,
						message: req.t('authentication:successfullyRegisteredFirstUser'),
						token: authConfig.removeTokenFromResponses ? undefined : result.token,
						user: result.user,
					},
					{ headers, status: 200 }
				)
			},
		},
	]
}
