import { createAuditEvent } from '@10x-media/audit-logs'
import type { BeforeRemoveArgs } from '@10x-media/dedupe/types'

/**
 * Dev stand only: one `@10x-media/audit-logs` entry per merge, on the primary, holding the
 * merged-in documents as they were and the fields the merge changed. Written through `req`, it
 * rolls back with a merge that fails.
 */
export const auditMerge = async ({
	req,
	collection,
	survivorId,
	absorbedIds,
	snapshots,
	decisions,
}: BeforeRemoveArgs): Promise<void> => {
	await createAuditEvent(req, {
		collection,
		documentId: survivorId,
		eventType: 'dedupe.merge',
		metadata: {
			absorbedIds,
			snapshots,
			decisions: decisions.filter((decision) => decision.changed),
		},
	})
}
