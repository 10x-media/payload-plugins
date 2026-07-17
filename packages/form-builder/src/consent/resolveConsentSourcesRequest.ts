import type { Payload, PayloadRequest } from 'payload'
import { FORMS_SLUG } from '../collections/forms'
import { resolveConsentEntries } from './resolveConsentEntries'
import type { ConsentSourcesResolver } from './types'

/** One selectable consent source for the consent field's `source` select. */
export type ConsentSourceOption = { label: string; value: string }

export type ResolveConsentSourcesRequestArgs = {
	payload: Payload
	formId: number | string | undefined
	/** Whether the caller is authenticated (an admin/user). */
	isAuthed: boolean
	req: PayloadRequest
	resolver: ConsentSourcesResolver
}

export type ResolveConsentSourcesRequestResult = {
	status: number
	body: { options: ConsentSourceOption[] } | { errors: { message: string }[] }
}

/**
 * Authorize and resolve the `GET /:id/consent-sources` request backing the consent `source` select:
 * authenticated callers get the host's sources for this request (a multi-tenant resolver scoping by
 * `req` therefore offers an author only their own tenant's), anonymous callers are always refused.
 * Statuses mirror the poll-options endpoint: 400 missing id, 403 unauthenticated, 404 unknown form,
 * 503 when the resolver throws (fail closed).
 */
export const resolveConsentSourcesRequest = async (
	args: ResolveConsentSourcesRequestArgs
): Promise<ResolveConsentSourcesRequestResult> => {
	const { payload, formId, isAuthed, req, resolver } = args
	if (!isAuthed) {
		return { status: 403, body: { errors: [{ message: 'Forbidden' }] } }
	}
	if (formId == null) {
		return { status: 400, body: { errors: [{ message: 'Missing form id' }] } }
	}
	const form = await payload
		.findByID({ collection: FORMS_SLUG, id: formId, depth: 0, overrideAccess: true, req })
		.catch(() => null)
	if (!form) {
		return { status: 404, body: { errors: [{ message: 'Not found' }] } }
	}
	try {
		const entries = await resolveConsentEntries({ payload, req, form, sources: resolver })
		return {
			status: 200,
			body: {
				options: entries.map((entry) => ({ label: entry.label ?? entry.key, value: entry.key })),
			},
		}
	} catch {
		return { status: 503, body: { errors: [{ message: 'Consent sources unavailable' }] } }
	}
}
