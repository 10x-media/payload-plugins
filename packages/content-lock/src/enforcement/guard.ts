import type { CollectionBeforeOperationHook, GlobalConfig } from 'payload'

import { assertUnlocked } from './assertUnlocked'

type GlobalBeforeOperationHook = NonNullable<
	NonNullable<GlobalConfig['hooks']>['beforeOperation']
>[number]

const COLLECTION_WRITES = new Set(['create', 'update', 'autosave', 'delete', 'restoreVersion'])
const GLOBAL_WRITES = new Set(['update', 'restoreVersion'])

/**
 * Rejects writes to a frozen collection. `beforeOperation` runs for every
 * channel (REST, GraphQL, admin, Local API) and regardless of
 * `overrideAccess`, which is what makes it authoritative.
 */
export const collectionGuard =
	(slug: string): CollectionBeforeOperationHook =>
	async ({ args, operation, req }) => {
		if (COLLECTION_WRITES.has(operation)) {
			await assertUnlocked(req, { type: 'collection', slug })
		}
		return args
	}

/** Rejects writes to a frozen global. */
export const globalGuard =
	(slug: string): GlobalBeforeOperationHook =>
	async ({ args, operation, req }) => {
		if (GLOBAL_WRITES.has(operation)) {
			await assertUnlocked(req, { type: 'global', slug })
		}
		return args
	}
