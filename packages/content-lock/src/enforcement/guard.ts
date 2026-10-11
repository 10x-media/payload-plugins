import type { CollectionBeforeOperationHook, GlobalConfig } from 'payload'

import { assertUnlocked } from './assertUnlocked'

type GlobalBeforeOperationHook = NonNullable<
	NonNullable<GlobalConfig['hooks']>['beforeOperation']
>[number]

const COLLECTION_WRITES = new Set(['create', 'update', 'delete', 'restoreVersion'])
const GLOBAL_WRITES = new Set(['update', 'restoreVersion'])

/**
 * Payload's forgot-password operation stores its token with a regular
 * `update` in the same request. That one write is the account's own, not
 * content, so it passes; anything else in the update still hits the lock.
 */
// A string key: the Local API copies `req.context` by its string keys only.
const FORGOT_PASSWORD = '@10x-media/content-lock:forgotPassword'
const RESET_FIELDS = new Set(['resetPasswordToken', 'resetPasswordExpiration'])

const isResetTokenWrite = (
	slug: string,
	operation: string,
	{ context, data }: { context: unknown; data: unknown }
): boolean => {
	if (
		operation !== 'update' ||
		(context as Record<string, unknown> | undefined)?.[FORGOT_PASSWORD] !== slug
	) {
		return false
	}
	return (
		typeof data === 'object' &&
		data !== null &&
		Object.keys(data).length > 0 &&
		Object.keys(data).every((key) => RESET_FIELDS.has(key))
	)
}

/**
 * Rejects writes to a frozen collection. `beforeOperation` runs for every
 * channel (REST, GraphQL, admin, Local API) and regardless of
 * `overrideAccess`, which is what makes it authoritative.
 */
export const collectionGuard =
	(slug: string): CollectionBeforeOperationHook =>
	async ({ args, operation, req }) => {
		if (operation === 'forgotPassword') {
			req.context[FORGOT_PASSWORD] = slug
			return args
		}
		if (
			COLLECTION_WRITES.has(operation) &&
			!isResetTokenWrite(slug, operation, {
				context: req.context,
				data: (args as { data?: unknown }).data,
			})
		) {
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
