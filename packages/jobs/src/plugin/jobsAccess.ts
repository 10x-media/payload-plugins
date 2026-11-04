import type { CollectionConfig, Config, PayloadRequest } from 'payload'

type JobsAccessConfig = NonNullable<NonNullable<Config['jobs']>['access']>
type Gate = (args: { req: PayloadRequest }) => boolean | Promise<boolean>

const loggedIn: Gate = ({ req }) => Boolean(req.user)

/**
 * Collection access for the jobs dashboard. Payload 4 denies every generic
 * operation on `payload-jobs`; the dashboard needs to read jobs and create them
 * from the form, so those two follow the host's own jobs gates: reading the
 * queue is what `jobs.access.run` allows, creating a job is queueing one
 * (`jobs.access.queue`). Both fall back to Payload's default for those gates, a
 * logged-in user. Update and delete keep Payload's denial: a job is a record
 * the runner owns, and cancelling goes through `payload.jobs.cancel`.
 *
 * `host` is the incoming `jobs.access`, read before this plugin hardens `run`
 * (see `index.ts`), so the dashboard follows the host's choice, not ours.
 */
export const jobsCollectionAccess = (
	host: JobsAccessConfig | undefined
): Pick<NonNullable<CollectionConfig['access']>, 'create' | 'read'> => {
	const run: Gate = host?.run ?? loggedIn
	const queue: Gate = host?.queue ?? loggedIn
	return {
		create: ({ req }) => queue({ req }),
		read: ({ req }) => run({ req }),
	}
}

/**
 * Layer the dashboard's access over a jobs collection, keeping any operation a
 * host override already replaced (anything that is no longer Payload's own
 * deny-all function from `defaultJobsCollection`).
 */
export const withJobsAccess = (
	collection: CollectionConfig,
	defaults: CollectionConfig,
	host: JobsAccessConfig | undefined
): CollectionConfig => {
	const ours = jobsCollectionAccess(host)
	const access = { ...collection.access }
	for (const operation of ['create', 'read'] as const) {
		if (access[operation] === defaults.access?.[operation]) {
			access[operation] = ours[operation]
		}
	}
	return { ...collection, access }
}
