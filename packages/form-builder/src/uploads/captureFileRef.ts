import type { CollectionSlug, Payload, PayloadRequest } from 'payload'
import { type ResolveFileRefResult, resolveFileRef } from './resolveFileRef'
import type { FileFieldConfig } from './types'

export type CaptureFileRefArgs = {
	payload: Payload
	collectionSlug: string
	uploadId: string | number
	config: FileFieldConfig
	req?: PayloadRequest
	/** Resolved submitter identity; must match the upload's `owner` stamp when both are present. */
	expectedOwner?: string
}

/**
 * Load the referenced upload doc and run the pure trust-boundary check. The client sends only the id; the
 * filename/mimeType/filesize are read authoritatively from the stored doc, never from the client. When the
 * upload carries an `owner` stamp AND the submitter is identifiable, the two must match, so an anonymous
 * submitter cannot capture another identity's upload; a mismatch collapses to `missing`, indistinguishable
 * from a deleted upload. When the submitter cannot be identified (no `expectedOwner`), ownership is not
 * enforced (fail-open, consistent with rate-limiting): a proxy-configured deployment identifies every
 * request, so this only relaxes scoping where it could not be applied fairly anyway. Unstamped uploads
 * (no identity at upload time, or a BYO collection without the field) pass unchanged.
 */
export const captureFileRef = async (args: CaptureFileRefArgs): Promise<ResolveFileRefResult> => {
	const { payload, collectionSlug, uploadId, config, req, expectedOwner } = args
	const doc = await payload
		.findByID({
			collection: collectionSlug as CollectionSlug,
			id: uploadId,
			depth: 0,
			overrideAccess: true,
			req,
		})
		.catch(() => null)
	if (doc && expectedOwner != null) {
		const owner = (doc as { owner?: unknown }).owner
		if (typeof owner === 'string' && owner.length > 0 && owner !== expectedOwner) {
			return { ok: false, code: 'missing' }
		}
	}
	return resolveFileRef(doc, config)
}
