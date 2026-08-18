import {
	type AuthCollectionSlug,
	addDataAndFileToRequest,
	addLocalesToRequestFromData,
	type CollectionSlug,
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
} from 'payload'
import { isNumber, parseCookies } from 'payload/shared'

import { extractAuthorizationToken } from './authorization'
import { generateExpiredIsolatedCookie, generateIsolatedCookie } from './cookies'

type EndpointFactoryArgs = {
	cookieName: string
	slug: CollectionSlug
}

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
 * Replacements for the built-in auth endpoints that read from and write to a
 * collection-scoped cookie. Each one delegates to the same core operation the built-in
 * handler uses, so behaviour (hooks, lockout, sessions, verification) is unchanged —
 * only the cookie name differs.
 *
 * Payload appends its built-in endpoints *after* the ones declared on the collection,
 * and `handleEndpoints` matches the first entry that fits. Declaring these on the
 * collection therefore shadows the built-ins.
 */
export const buildIsolatedAuthEndpoints = ({
	cookieName,
	slug,
}: EndpointFactoryArgs): Endpoint[] => {
	const getCollection = (req: PayloadRequest) => {
		const collection = req.payload.collections[slug]
		if (!collection) {
			throw new Error(`dualSession: collection "${slug}" is not registered on payload.`)
		}
		return collection
	}

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

				if (result.token) {
					headers.set(
						'Set-Cookie',
						generateIsolatedCookie({ authConfig, name: cookieName, token: result.token })
					)
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

				headers.set(
					'Set-Cookie',
					generateExpiredIsolatedCookie({ authConfig: collection.config.auth, name: cookieName })
				)

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

				if (result.setCookie && refreshedToken) {
					headers.set(
						'Set-Cookie',
						generateIsolatedCookie({ authConfig, name: cookieName, token: refreshedToken })
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
				// the shared cookie — it would report the admin's token back to a frontend user.
				// With no isolated cookie the request was authenticated by something else (an
				// `Authorization` header, a custom strategy), so fall back to core's own
				// extraction rather than reporting no token at all.
				const currentToken =
					parseCookies(req.headers).get(cookieName) ??
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

				if (result.token) {
					headers.set(
						'Set-Cookie',
						generateIsolatedCookie({ authConfig, name: cookieName, token: result.token })
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

				if (result.token) {
					headers.set(
						'Set-Cookie',
						generateIsolatedCookie({ authConfig, name: cookieName, token: result.token })
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
