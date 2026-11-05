import type { Access, CollectionConfig, Config, Payload } from 'payload'
import { isAdminUser } from '../access/adminUser'
import { TASK_SLUGS } from '../core/jobs'
import { listOf } from '../core/values'
import { collectingPageData } from './buildPhase'

/** Payload's job-stats global (payload/src/queues/config/global.ts), added for scheduled tasks. */
export const JOB_STATS_GLOBAL = 'payload-jobs-stats'

/** The `jobs.access` entries Payload defaults to any signed-in user (payload/src/config/defaults.ts). */
const JOB_CONTROLS = ['run', 'queue', 'cancel'] as const

/**
 * The `payload-jobs` operations a host leaves unset. Payload 3.85 sets none, so each falls back to any
 * signed-in user; 3.89 and later deny them all (payload/src/queues/config/collection.ts).
 */
const JOB_OPERATIONS = ['create', 'read', 'update', 'delete'] as const

/** Configs already initialized, so instances sharing one config say what they restricted once. */
const initialized = new WeakSet<object>()

/** Configs whose stats global is narrowed already, so no access is wrapped twice. */
const narrowed = new WeakSet<object>()

const pluginTaskSlugs: ReadonlySet<string> = new Set(Object.values(TASK_SLUGS))

const runsPluginTasks = (tasks: ReadonlyArray<{ slug: string }> | undefined): boolean =>
	tasks?.some((task) => pluginTaskSlugs.has(task.slug)) === true

const adminOnly =
	(previous: Access): Access =>
	(args) =>
		isAdminUser(args) ? previous(args) : false

/**
 * Limits stats global `read` and `update` to the admin collection, once per config. Payload adds it
 * with no access, so it is narrowed at init and after an HMR reload, which runs no `onInit`.
 */
export const narrowStatsGlobal = (payload: Payload): boolean => {
	const { config } = payload
	if (narrowed.has(config) || !runsPluginTasks(config.jobs?.tasks)) {
		return false
	}
	narrowed.add(config)
	const global = config.globals.find((each) => each.slug === JOB_STATS_GLOBAL)
	if (!global) {
		return false
	}
	const { access } = global
	access.read = adminOnly(access.read)
	access.update = adminOnly(access.update)
	return true
}

/**
 * Once a plugin task turns Payload's jobs on, every job control the host left unset admits only
 * admin-collection users rather than anyone signed in; a host-set control never changes.
 */
export const restrictJobControls = (config: Config): void => {
	const jobs = config.jobs
	if (!jobs || !runsPluginTasks(jobs.tasks)) {
		return
	}
	const controls = JOB_CONTROLS.filter((control) => jobs.access?.[control] === undefined)
	const operations = new Set<(typeof JOB_OPERATIONS)[number]>()
	const previous = jobs.jobsCollectionOverrides
	const access = { ...jobs.access }
	for (const control of controls) {
		access[control] = isAdminUser
	}
	config.jobs = {
		...jobs,
		access,
		jobsCollectionOverrides: ({ defaultJobsCollection }): CollectionConfig => {
			const base = previous ? previous({ defaultJobsCollection }) : defaultJobsCollection
			const collectionAccess = { ...base.access }
			for (const operation of JOB_OPERATIONS) {
				if (collectionAccess[operation] === undefined) {
					collectionAccess[operation] = isAdminUser
					operations.add(operation)
				}
			}
			return { ...base, access: collectionAccess }
		},
	}
	const prevOnInit = config.onInit
	config.onInit = async (payload) => {
		if (!initialized.has(payload.config)) {
			initialized.add(payload.config)
			const global = narrowStatsGlobal(payload)
			const restricted = [
				...(controls.length > 0 ? [`jobs.access.${listOf(controls)}`] : []),
				...(operations.size > 0
					? [`the payload-jobs collection's ${listOf([...operations])}`]
					: []),
			]
			// `next build` boots once per worker and serves nothing; the server that does says it.
			if (restricted.length > 0 && !collectingPageData()) {
				const named = [
					...restricted,
					...(global ? [`the ${JOB_STATS_GLOBAL} global's read and update`] : []),
				]
				payload.logger?.warn(
					`analytics: Payload's job controls the config left unset now admit users of the "${payload.config.admin.user}" collection only: ${named.join('; ')}. Set jobs.access, and access in jobs.jobsCollectionOverrides, in your Payload config to choose who may run, queue, cancel and read jobs.`
				)
			}
		}
		await prevOnInit?.(payload)
	}
}
