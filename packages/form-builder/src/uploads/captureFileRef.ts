import type { CollectionSlug, Payload, PayloadRequest } from 'payload'
import { type ResolveFileRefResult, resolveFileRef } from './resolveFileRef'
import type { FileFieldConfig } from './types'

export type CaptureFileRefArgs = {
	payload: Payload
	collectionSlug: string
	uploadId: string | number
	config: FileFieldConfig
	req?: PayloadRequest
	/** Resolved request identity; must match the upload's `owner` stamp when present. */
	expectedOwner?: string
	/** The submission's form id; must match the upload's `form` stamp when present. */
	expectedForm?: string | number
}

/**
 * Load the referenced upload doc and run the pure trust-boundary check. The client sends only the id; the
 * filename/mimeType/filesize are read authoritatively from the stored doc, never from the client. When the
 * upload carries an `owner` (or `form`) stamp, the referencing submission's identity/form must match, so an
 * anonymous submitter cannot capture another identity's upload; a mismatch collapses to `missing`,
 * indistinguishable from a deleted upload. Unstamped uploads (no identity at upload time, or a BYO
 * collection without the field) pass unchanged.
 */
export const captureFileRef = async (args: CaptureFileRefArgs): Promise<ResolveFileRefResult> => {
	const { payload, collectionSlug, uploadId, config, req, expectedOwner, expectedForm } = args
	const doc = await payload
		.findByID({
			collection: collectionSlug as CollectionSlug,
			id: uploadId,
			depth: 0,
			overrideAccess: true,
			req,
		})
		.catch(() => null)
	if (doc) {
		const owner = (doc as { owner?: unknown }).owner
		if (typeof owner === 'string' && owner.length > 0 && owner !== expectedOwner) {
			return { ok: false, code: 'missing' }
		}
		const formStamp = (doc as { form?: unknown }).form
		if (
			formStamp != null &&
			formStamp !== '' &&
			expectedForm != null &&
			String(formStamp) !== String(expectedForm)
		) {
			return { ok: false, code: 'missing' }
		}
	}
	return resolveFileRef(doc, config)
}
