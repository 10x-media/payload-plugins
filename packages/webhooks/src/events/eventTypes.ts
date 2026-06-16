import type { WebhookOperation } from '../options'

const OP_TO_EVENT: Record<WebhookOperation, string> = {
	create: 'created',
	update: 'updated',
	delete: 'deleted',
}

/** Past-tense public event suffix for a Payload operation. */
export const operationToEvent = (op: WebhookOperation): string => OP_TO_EVENT[op]

/** Public event id, e.g. `posts.created`. */
export const eventId = (collectionSlug: string, op: WebhookOperation): string =>
	`${collectionSlug}.${operationToEvent(op)}`

/** Every event id the given opt-in collections can emit, in declaration order. */
export const eventCatalog = (
	collections: Record<string, true | { operations?: WebhookOperation[] }>
): string[] => {
	const out: string[] = []
	for (const [slug, cfg] of Object.entries(collections)) {
		const ops = (cfg === true ? undefined : cfg.operations) ?? ['create', 'update', 'delete']
		for (const op of ops) {
			out.push(eventId(slug, op))
		}
	}
	return out
}
