import type { PayloadRequest } from 'payload'

import { DOC_PREFERENCE_PROPERTY, docPreferenceKeyFor, preferenceKeyFor } from '../plugin/constants'

/** The shape the switcher stores under `form-variants-<slug>`. */
export type StoredChoice = { variant?: string }

/** The property the plugin adds to a document's own Payload preferences. */
export type StoredSteps = { steps?: Record<string, string> }

export type StoredPreferences = {
	/** The step each variant was last left on, by variant key. Empty on a new document. */
	steps: Record<string, string>
	variant: null | string
}

const EMPTY: StoredPreferences = { steps: {}, variant: null }

/**
 * The account's stored variant choice for the collection and, on a saved document, the step
 * each variant was left on. Both are read here on the server so the page opens on them rather
 * than moving a moment later, and both come back in one query.
 *
 * Payload's own `payload-preferences` collection, so it works on both database adapters and
 * the plugin adds no storage of its own.
 */
export const getStoredPreferences = async (
	req: PayloadRequest,
	collectionSlug: string,
	id: number | string | undefined
): Promise<StoredPreferences> => {
	if (!req.user?.collection) {
		return EMPTY
	}
	const choiceKey = preferenceKeyFor(collectionSlug)
	const documentKey = id === undefined ? null : docPreferenceKeyFor(collectionSlug, id)
	const found = await req.payload.find({
		collection: 'payload-preferences',
		depth: 0,
		limit: 2,
		pagination: false,
		req,
		where: {
			and: [
				{ key: { in: documentKey ? [choiceKey, documentKey] : [choiceKey] } },
				{ 'user.relationTo': { equals: req.user.collection } },
				{ 'user.value': { equals: req.user.id } },
			],
		},
	})

	const choice = found.docs.find((doc) => doc.key === choiceKey)?.value as StoredChoice | undefined
	const document = documentKey
		? (found.docs.find((doc) => doc.key === documentKey)?.value as
				| Record<string, unknown>
				| undefined)
		: undefined
	const steps = (document?.[DOC_PREFERENCE_PROPERTY] as StoredSteps | undefined)?.steps

	return {
		steps: steps && typeof steps === 'object' ? steps : {},
		variant: typeof choice?.variant === 'string' ? choice.variant : null,
	}
}
