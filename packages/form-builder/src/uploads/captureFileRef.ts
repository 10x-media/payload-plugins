import type { CollectionSlug, Payload, PayloadRequest } from 'payload'
import { type ResolveFileRefResult, resolveFileRef } from './resolveFileRef'
import type { FileFieldConfig } from './types'

export type CaptureFileRefArgs = {
	payload: Payload
	collectionSlug: string
	uploadId: string | number
	config: FileFieldConfig
	req?: PayloadRequest
}

/**
 * Load the referenced upload doc and run the pure trust-boundary check. The client sends only the id; the
 * filename/mimeType/filesize are read authoritatively from the stored doc, never from the client.
 */
export const captureFileRef = async (args: CaptureFileRefArgs): Promise<ResolveFileRefResult> => {
	const { payload, collectionSlug, uploadId, config, req } = args
	const doc = await payload
		.findByID({
			collection: collectionSlug as CollectionSlug,
			id: uploadId,
			depth: 0,
			overrideAccess: true,
			req,
		})
		.catch(() => null)
	return resolveFileRef(doc, config)
}
