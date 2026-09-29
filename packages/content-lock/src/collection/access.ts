import { type Access, type CollectionConfig, getCurrentDate, type Where } from 'payload'

/**
 * Lock windows that have not ended at `now`: never ended by hand, and either
 * ending manually or ending later. The plugin already folds it into the lock
 * collection's `update`; exported for queries of your own.
 */
export const notEndedWhere = (now: Date): Where => ({
	and: [
		{ endedAt: { exists: false } },
		{
			or: [
				{ endAtTime: { equals: false } },
				{ endAtTime: { exists: false } },
				{ endsAt: { greater_than: now.toISOString() } },
			],
		},
	],
})

/**
 * `update` access that keeps ended windows read-only on top of `original`
 * (or Payload's default, any signed-in user). An ended window is history: the
 * admin opens it read-only, and deleting it stays allowed.
 */
export const updateUnlessEnded =
	(original: Access | undefined): Access =>
	async (args) => {
		const base = original ? await original(args) : Boolean(args.req.user)
		if (!base) {
			return false
		}
		const notEnded = notEndedWhere(getCurrentDate())
		return base === true ? notEnded : { and: [base, notEnded] }
	}

/** The `collection.access` option: per operation, or one function for every write. */
export type LockAccessOption = CollectionConfig['access'] | Access

/**
 * Expand the option into collection access. One function governs create,
 * update and delete; read stays Payload's default (signed-in users), so the
 * banner and the list keep working for everyone.
 */
export const resolveLockAccess = (option: LockAccessOption): CollectionConfig['access'] =>
	typeof option === 'function' ? { create: option, delete: option, update: option } : option
