import type { WmsApiClient } from '@wildix/wms-api-client'
import type { CollectionSlug, PayloadRequest, Where } from 'payload'
import type { WildixCredentials } from '../types'
import { buildWmsClient } from './wildixClient'
import { tokenProviderForUser } from './wildixSyncHandlers'

export type ResolvedClient = { client: WmsApiClient; userExtension?: string }

type ResolveOptions = {
	req: PayloadRequest
	credentials: WildixCredentials
	wildixUsersSlug?: string
	/** When set, resolve the linked Wildix user by this email (single-user mode). */
	singleUserEmail?: string
}

const findLinkedUser = async ({
	req,
	wildixUsersSlug,
	singleUserEmail,
}: ResolveOptions): Promise<Record<string, unknown> | undefined> => {
	if (!wildixUsersSlug) return undefined
	const where: Where | null = singleUserEmail
		? { email: { equals: singleUserEmail } }
		: req.user
			? { 'payloadUser.value': { equals: req.user.id } }
			: null
	if (!where) return undefined
	const result = await req.payload.find({
		collection: wildixUsersSlug as CollectionSlug,
		where,
		limit: 1,
		depth: 0,
		overrideAccess: true,
	})
	return result.docs[0] as Record<string, unknown> | undefined
}

/**
 * Resolves a WMS client plus the target user extension for the current request.
 * In OAuth2 mode the client uses the linked user's own refreshing token; in
 * API-key mode a shared client is used and the extension scopes the operation.
 */
export const resolveWildixClient = async (
	options: ResolveOptions
): Promise<ResolvedClient | { error: Response }> => {
	const { req, credentials, wildixUsersSlug } = options
	const doc = await findLinkedUser(options)
	const userExtension = doc?.extension as string | undefined

	if (credentials.authType !== 'oauth2') {
		return { client: buildWmsClient(credentials), userExtension }
	}

	if (!wildixUsersSlug || !doc) {
		return { error: Response.json({ error: 'No Wildix account connected' }, { status: 403 }) }
	}

	const provider = tokenProviderForUser({ payload: req.payload, credentials, wildixUsersSlug, doc })
	if (!provider) {
		return { error: Response.json({ error: 'No Wildix account connected' }, { status: 403 }) }
	}

	return { client: buildWmsClient(credentials, provider), userExtension }
}
