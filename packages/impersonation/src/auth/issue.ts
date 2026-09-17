import type { CollectionSlug, Payload, PayloadRequest, TypedUser } from 'payload'
import { getFieldsToSign, jwtSign } from 'payload'
import { addSessionToUser, generatePayloadCookie } from 'payload/shared'

import type { IssuedSession, SessionIssueArgs } from '../types'
import { sharedCookieName } from './cookies'
import { isolatedAuthCookie, resolveMode } from './mode'

type RawUser = TypedUser & { email?: string; sessions?: { expiresAt: Date | string; id: string }[] }

export const issueSession = async ({
	collection,
	payload,
	req,
	userId,
}: SessionIssueArgs): Promise<IssuedSession> => {
	const registered = payload.collections[collection]
	if (!registered) {
		throw new Error(`@10x-media/impersonation: collection "${collection}" is not registered`)
	}

	const collectionConfig = registered.config
	const raw = (await payload.db.findOne({
		collection: collection as CollectionSlug,
		req,
		where: { id: { equals: userId } },
	})) as null | RawUser

	if (!raw) {
		throw new Error(`@10x-media/impersonation: target ${collection}/${userId} was not found`)
	}

	raw.collection = collectionConfig.slug as TypedUser['collection']
	const { sid } = await addSessionToUser({
		collectionConfig,
		payload,
		req,
		user: raw,
	})

	if (!sid) {
		throw new Error(
			`@10x-media/impersonation: "${collection}" did not mint a session id (useSessions is off)`
		)
	}

	const fieldsToSign = getFieldsToSign({
		collectionConfig,
		email: raw.email ?? '',
		sid,
		user: raw,
	})
	const { exp, token } = await jwtSign({
		fieldsToSign,
		secret: payload.secret,
		tokenExpiration: collectionConfig.auth.tokenExpiration,
	})

	const { cookieName, isolated } = await resolveMode({ collection, payload, user: raw })
	const cookie = isolated
		? ((await isolatedAuthCookie({ collection, payload, token, user: raw })) ??
			generatePayloadCookie({
				collectionAuthConfig: collectionConfig.auth,
				cookiePrefix: payload.config.cookiePrefix,
				token,
			}))
		: generatePayloadCookie({
				collectionAuthConfig: collectionConfig.auth,
				cookiePrefix: payload.config.cookiePrefix,
				token,
			})

	return {
		cookie,
		cookieName: isolated ? cookieName : sharedCookieName(payload.config.cookiePrefix),
		exp,
		mode: isolated ? 'parallel' : 'swap',
		sid,
		token,
		user: raw,
	}
}

export const resignSession = async ({
	collection,
	payload,
	req,
	sid,
	userId,
}: {
	collection: CollectionSlug
	payload: Payload
	req: PayloadRequest
	sid: string
	userId: number | string
}): Promise<{ cookie: string; exp: number; token: string } | null> => {
	const registered = payload.collections[collection]
	if (!registered) {
		return null
	}

	const collectionConfig = registered.config
	const raw = (await payload.db.findOne({
		collection: collection as CollectionSlug,
		req,
		where: { id: { equals: userId } },
	})) as null | RawUser

	if (!raw) {
		return null
	}

	const session = (raw.sessions ?? []).find((entry) => entry.id === sid)
	if (!session) {
		return null
	}

	const expiresAt = new Date(session.expiresAt as Date | string)
	if (expiresAt.getTime() <= Date.now()) {
		return null
	}

	const fieldsToSign = getFieldsToSign({
		collectionConfig,
		email: raw.email ?? '',
		sid,
		user: raw,
	})
	const { exp, token } = await jwtSign({
		fieldsToSign,
		secret: payload.secret,
		tokenExpiration: collectionConfig.auth.tokenExpiration,
	})

	return {
		cookie: generatePayloadCookie({
			collectionAuthConfig: collectionConfig.auth,
			cookiePrefix: payload.config.cookiePrefix,
			token,
		}),
		exp,
		token,
	}
}
