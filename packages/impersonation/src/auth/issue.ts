import type { CollectionSlug, Payload, PayloadRequest, TypedUser } from 'payload'
import { getFieldsToSign, jwtSign } from 'payload'
import { generatePayloadCookie } from 'payload/shared'

import { IMPERSONATION_SID_PREFIX } from '../plugin/constants'
import type { IssuedSession, SessionIssueArgs } from '../types'
import { sharedCookieName } from './cookies'
import { isolatedAuthCookie, resolveMode } from './mode'

type RawUser = TypedUser & {
	email?: string
	sessions?: { createdAt?: null | string; expiresAt: string; id: string }[] | null
}

const tokenExpirationOf = (auth: boolean | { tokenExpiration?: number; useSessions?: boolean }) => {
	if (auth === true || auth === false) {
		return 7200
	}
	return auth.tokenExpiration ?? 7200
}

/**
 * Mint a target session with a prefixed sid so decorateAuth can skip the DB
 * on requests that cannot be impersonation.
 */
const mintPrefixedSession = async ({
	collection,
	collectionConfig,
	payload,
	raw,
	req,
}: {
	collection: CollectionSlug
	collectionConfig: { auth: boolean | { tokenExpiration?: number; useSessions?: boolean } }
	payload: Payload
	raw: RawUser
	req: PayloadRequest
}): Promise<string> => {
	if (typeof collectionConfig.auth === 'object' && collectionConfig.auth.useSessions === false) {
		throw new Error(
			`@10x-media/impersonation: "${collection}" did not mint a session id (useSessions is off)`
		)
	}

	const now = new Date()
	const sid = `${IMPERSONATION_SID_PREFIX}${crypto.randomUUID()}`
	const sessions = [
		...(raw.sessions ?? []).filter((session) => new Date(session.expiresAt) > now),
		{
			createdAt: now.toISOString(),
			expiresAt: new Date(
				now.getTime() + tokenExpirationOf(collectionConfig.auth) * 1000
			).toISOString(),
			id: sid,
		},
	]
	await payload.db.updateOne({
		collection,
		data: { sessions },
		id: raw.id,
		req,
		returning: false,
	})
	raw.sessions = sessions as RawUser['sessions']
	return sid
}

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
	const sid = await mintPrefixedSession({
		collection: collection as CollectionSlug,
		collectionConfig,
		payload,
		raw,
		req,
	})

	const fieldsToSign = getFieldsToSign({
		collectionConfig,
		email: raw.email ?? '',
		sid,
		user: raw,
	})
	const { exp, token } = await jwtSign({
		fieldsToSign,
		secret: payload.secret,
		tokenExpiration: tokenExpirationOf(collectionConfig.auth),
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
		tokenExpiration: tokenExpirationOf(collectionConfig.auth),
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
