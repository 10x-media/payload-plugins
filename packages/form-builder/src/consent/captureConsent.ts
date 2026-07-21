import { createHash } from 'node:crypto'
import type { Payload, PayloadRequest } from 'payload'
import { hasDraftsEnabled } from 'payload/shared'
import { textOfBody } from '../actions/body/textOfBody'
import type { FormFieldInstance } from '../submissions/types'
import { resolvePublishedVersionRef } from './resolvePublishedVersionRef'
import type { ConsentSourceEntry, ConsentSourcePage } from './types'

/** What a submission snapshots of the agreed wording. `'hash'` and `'text'` combine as `'both'`. */
export type ConsentSnapshotMode = 'hash' | 'text' | 'both' | false

export type ConsentProof = {
	agreed: boolean
	/** The source `id` the field referenced; empty when the author never picked one. */
	source: string
	page?: ConsentSourcePage
	versionRef?: string
	/** The source label at submit time, so an audit names the statement even after a rename or delete. */
	name?: string
	/** sha256 of the statement plain text agreed to: tamper-evident and PII-free. */
	statementHash?: string
	/** Plain-text snapshot of the statement agreed to, for a human-readable audit. */
	statementText?: string
	at: string
}

/**
 * The authoritative consent proof, built at submit time from the server's own view of the source
 * (the field carries an id, never a statement, so there is nothing here the client could forge).
 *
 * Proof is id-based on purpose: it records which document was agreed to, so renaming, re-slugging,
 * or re-routing the policy leaves every past proof intact and resolvable. `snapshot` additionally
 * captures the agreed wording (a `statementHash`, the plain `statementText`, or both) plus the source
 * `name`, so an audit shows exactly what was agreed to independent of later edits; `false` keeps the
 * lean id-only proof. The snapshot is captured in every branch, including a refusal and a page-less
 * source.
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
	/** What to snapshot of the agreed wording (plugin option `consent.snapshot`); defaults to `'both'`. */
	snapshot?: ConsentSnapshotMode
}): Promise<ConsentProof> => {
	const source = typeof args.field.source === 'string' ? args.field.source : ''
	const entry = source ? args.entries.find((candidate) => candidate.id === source) : undefined
	const snapshot = args.snapshot ?? 'both'

	// Capture the agreed wording (and the source label) onto every proof branch. Kept out of the two
	// returns so a refusal and a page-less source are snapshotted the same as the happy path.
	const withSnapshot = (proof: ConsentProof): ConsentProof => {
		if (!entry || snapshot === false) {
			return proof
		}
		if (typeof entry.name === 'string' && entry.name.trim().length > 0) {
			proof.name = entry.name.trim()
		}
		const text = textOfBody(entry.statement)
		if (text.length > 0) {
			if (snapshot === 'hash' || snapshot === 'both') {
				proof.statementHash = createHash('sha256').update(text).digest('hex')
			}
			if (snapshot === 'text' || snapshot === 'both') {
				proof.statementText = text
			}
		}
		return proof
	}

	const page = entry?.page
	if (!page) {
		return withSnapshot({ agreed: args.agreed, source, at: args.now })
	}
	// `page.relationTo` is a runtime string; cast the key so the lookup type-checks against a host's
	// narrowed collection map (a consumer's generated `CollectionSlug`) as well as the plugin's own
	// broad one. The value is still guarded below, since an unregistered slug resolves to undefined.
	const collection = args.payload.collections[page.relationTo as keyof Payload['collections']]
	const versionRef =
		collection && hasDraftsEnabled(collection.config)
			? await resolvePublishedVersionRef({
					payload: args.payload,
					collection: page.relationTo,
					id: page.id,
					req: args.req,
				})
			: null
	return withSnapshot({
		agreed: args.agreed,
		source,
		page: { relationTo: page.relationTo, id: page.id },
		...(versionRef ? { versionRef } : {}),
		at: args.now,
	})
}
