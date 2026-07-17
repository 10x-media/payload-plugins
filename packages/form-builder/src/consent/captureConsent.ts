import type { Payload, PayloadRequest } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'
import type { FormFieldInstance } from '../submissions/types'
import { resolvePublishedVersionRef } from './resolvePublishedVersionRef'
import type { ConsentSourceEntry, ConsentSourcePage } from './types'

export type ConsentProof = {
	agreed: boolean
	/** The source `key` the field referenced; empty when the author never picked one. */
	source: string
	page?: ConsentSourcePage
	versionRef?: string
	at: string
}

/**
 * The authoritative consent proof, built at submit time from the server's own view of the source
 * (the field carries a key, never a statement, so there is nothing here the client could forge).
 *
 * Proof is id-based on purpose: it records which document was agreed to, so renaming, re-slugging,
 * or re-routing the policy leaves every past proof intact and resolvable. The statement text is
 * never stored, so editing a policy cannot rewrite history either.
 *
 * `versionRef` is recorded only when the page's collection has drafts enabled, and then it is the
 * published version document's own id. Versions without drafts get no `versionRef`, because there
 * is no published/draft distinction to pin to: `_status` only exists under drafts, so a
 * published-version lookup there matches nothing, and recording that as a version reference would
 * be inventing one. Absent means absent, in both cases.
 *
 * `now` is injected by the caller (`new Date().toISOString()`) for testability.
 */
export const captureConsent = async (args: {
	field: FormFieldInstance
	agreed: boolean
	/** The host's resolved sources for this request (see `resolveConsentEntries`). */
	entries: ConsentSourceEntry[]
	payload: Payload
	req?: PayloadRequest
	now: string
}): Promise<ConsentProof> => {
	const source = typeof args.field.source === 'string' ? args.field.source : ''
	const page = source ? args.entries.find((entry) => entry.key === source)?.page : undefined
	if (!page) {
		return { agreed: args.agreed, source, at: args.now }
	}
	const collection = args.payload.collections[page.relationTo]
	const versionRef =
		collection && hasDraftsEnabled(collection.config)
			? await resolvePublishedVersionRef({
					payload: args.payload,
					collection: page.relationTo,
					id: page.id,
					req: args.req,
				})
			: null
	return {
		agreed: args.agreed,
		source,
		page: { relationTo: page.relationTo, id: page.id },
		...(versionRef ? { versionRef } : {}),
		at: args.now,
	}
}
