import { type Access, getCurrentDate, type Where } from 'payload'

/**
 * Lock windows that have not ended at `now`: never ended by hand, and either
 * ending manually or ending later. Use it in a replaced `update` access
 * (`collection.overrides`) to keep ended windows read-only.
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
