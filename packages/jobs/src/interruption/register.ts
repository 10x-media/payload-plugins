import type { Config, Field } from 'payload'

import type { HeartbeatPlan } from '../reliability/heartbeat'
import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'
import { JOBS_CUSTOM_KEY, type JobsRegistry } from './registry'
import { resumeDeferred } from './resume'
import { wrapJobHandlers } from './wrap'

/** Options for how running jobs react to an interruption. */
export type InterruptOptions = {
	/**
	 * Task and workflow slugs that go back to the queue when interrupted, for
	 * handlers you cannot wrap in `deferOnInterrupt` (another plugin's tasks,
	 * handlers registered by path). Every other job fails for good.
	 */
	defer?: string[]
}

/** Who deferred a job; set on deferral, cleared by `resumeDeferred`. */
const deferredByField = (): Field => ({
	name: 'deferredBy',
	type: 'text',
	label: labelForKey(keys.fieldDeferredBy),
	admin: { position: 'sidebar', readOnly: true },
	index: true,
})

/**
 * Create the extension registry on `config.custom`, add the `deferredBy` field
 * to `payload-jobs`, and wrap job handlers at init (before any host `onInit`
 * can run a job).
 */
export const registerInterruption = (
	config: Config,
	options: InterruptOptions | undefined,
	heartbeat: HeartbeatPlan | null
): void => {
	const registry: JobsRegistry = {
		api: { resumeDeferred },
		extensions: { interruptOn: [], runGates: [] },
		plan: { defer: options?.defer ?? [], heartbeat },
	}
	config.custom = { ...config.custom, [JOBS_CUSTOM_KEY]: registry }

	const existingOverride = config.jobs?.jobsCollectionOverrides
	config.jobs = {
		...config.jobs,
		jobsCollectionOverrides: ({ defaultJobsCollection }) => {
			const base = existingOverride
				? existingOverride({ defaultJobsCollection })
				: defaultJobsCollection
			return { ...base, fields: [...base.fields, deferredByField()] }
		},
	}

	const previousOnInit = config.onInit
	config.onInit = async (payload) => {
		wrapJobHandlers(payload)
		await previousOnInit?.(payload)
	}
}
