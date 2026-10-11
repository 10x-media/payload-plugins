import { isValidID, type PayloadRequest } from 'payload'

/**
 * Whether `id` can be a document id of `collection`. Ids come from the
 * browser (a route, a conversation key, a send); a malformed one makes the
 * database throw (an ObjectId cast, an integer column) instead of finding
 * nothing, so check before querying and answer 404 or 400.
 */
export const isDocumentId = (
	req: PayloadRequest,
	collection: string,
	id: number | string
): boolean => {
	const type =
		req.payload.collections[collection as keyof typeof req.payload.collections]?.customIDType ??
		(req.payload.db.name === 'mongoose' ? 'ObjectID' : req.payload.db.defaultIDType)
	return isValidID(type === 'number' ? Number(id) : id, type)
}
