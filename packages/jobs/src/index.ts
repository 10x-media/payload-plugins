import { type Config, definePlugin } from 'payload'

import type { JobsPluginOptions } from './options'
import { applyCollectionOverride } from './plugin/applyCollectionOverride'
import { registerJobsEnhancements } from './plugin/registerJobsEnhancements'
import { registerTranslations } from './plugin/registerTranslations'
import { resolveQueueControlOptions } from './queueControl/options'
import { registerQueueControl } from './queueControl/registerQueueControl'
import { resolveReliabilityOptions } from './reliability/options'
import { registerReliability } from './reliability/registerReliability'

declare module 'payload' {
	interface RegisteredPlugins {
		'@10x-media/jobs': JobsPluginOptions
	}
}

/**
 * Jobs plugin for Payload v3. Enhances the built-in `payload-jobs` collection
 * with an ops dashboard (status, queue health, error and log panels) and the
 * supporting i18n. Authored with `definePlugin` so the automations and webhooks
 * plugins can detect it by slug. Runs first (`order: 0`).
 */
export const jobs = definePlugin<JobsPluginOptions>({
	slug: '@10x-media/jobs',
	order: 0,
	plugin: ({ config, plugins: _plugins, ...options }): Config => {
		if (options.disabled === true) {
			return config
		}
		registerTranslations(config, options.translations)
		const reliability = resolveReliabilityOptions(options.reliability)
		const queueControl = resolveQueueControlOptions(options.queueControl)
		// JobsPluginOptions is assignable to JobsOptions (the extra `disabled` is ignored).
		registerJobsEnhancements(config, options, [
			...(options.queues ?? []),
			...(queueControl?.queues ?? []),
		])
		if (reliability) {
			registerReliability(config, reliability)
		}
		if (queueControl) {
			registerQueueControl(config, queueControl, reliability)
		}
		// Core defaults jobs.access.run to any logged-in user (`defaultAccess`), gating both
		// /payload-jobs/run and /handle-schedules. With queue control off nothing else hardens
		// them, so deny unless the host made an explicit choice.
		if (!queueControl && config.jobs && config.jobs.access?.run === undefined) {
			config.jobs = {
				...config.jobs,
				access: { ...config.jobs.access, run: () => false },
			}
		}
		if (options.overrides?.jobs) {
			const previous = config.jobs?.jobsCollectionOverrides
			const override = options.overrides.jobs
			config.jobs = {
				...config.jobs,
				jobsCollectionOverrides: ({ defaultJobsCollection }) =>
					applyCollectionOverride(
						previous ? previous({ defaultJobsCollection }) : defaultJobsCollection,
						override
					),
			}
		}
		return config
	},
})

export {
	type AutoRunConfigOptions,
	type AutoRunQueueConfig,
	autoRunConfig,
} from './execution/autoRunConfig'
export { type DrainDeps, type DrainOptions, type DrainResult, drainWorker } from './execution/drain'
export { type CreateWorkerArgs, createWorker, type Worker } from './execution/worker'
export type { JobStatus, JobStatusInput } from './jobs/deriveJobStatus'
export { deriveJobStatus } from './jobs/deriveJobStatus'
export type {
	JobLogEntry,
	JobLogEntryComponents,
	JobLogSlot,
	JobLogSlotComponents,
	JobLogSlotProps,
} from './jobs/logSlotComponents'
export type {
	CollectionOverride,
	FieldsOverride,
	JobsOptions,
	JobsPluginOptions,
	JobsPluginOptions as PluginOptions,
} from './options'
export type { JobInputComponentProps, JobInputComponents } from './plugin/inputComponents'
export type { JobInputExamples, JobInputPlaceholders } from './plugin/inputPlaceholders'
export {
	multiNodePreset,
	serverlessPreset,
	singleNodePreset,
	type TopologyPreset,
	type VercelCron,
	vercelCrons,
} from './presets/presets'
export { cronSecretAccess, type JobAccess, loggedInAccess } from './queueControl/access'
export type { QueueControlOptions } from './queueControl/options'
export type { PauseState } from './queueControl/pauseState'
export { createPauseStore, type PauseStore } from './queueControl/pauseStore'
export {
	type GetQueueHealthOptions,
	getQueueHealth,
	type QueueHealth,
	type QueueHealthReport,
} from './queueControl/queueHealth'
export {
	type IdempotencyStore,
	withIdempotencyKey,
} from './reliability/concurrencyContract'
export {
	createJobLeaseStore,
	type DeadLetterArgs,
	type JobId,
	type JobLeaseResult,
	type JobLeaseRow,
	type JobLeaseStore,
	type StampResult,
} from './reliability/jobLeaseStore'
export {
	createLeaderController,
	type LeaderController,
} from './reliability/leaderController'
export {
	createLeaseStore,
	type LeaseRecord,
	type LeaseResult,
	type LeaseStore,
} from './reliability/leaseStore'
export { JOBS_LOCKS_SLUG, LEADER_ROLES, type LeaderRole } from './reliability/locksCollection'
export type { ReliabilityOptions } from './reliability/options'
export {
	type ResolvedReliabilityOptions,
	resolveReliabilityOptions,
} from './reliability/options'
export { decideRecovery, type RecoveryDecision } from './reliability/recoveryDecision'
export { type RunSweepArgs, runSweep, type SweepResult } from './reliability/sweeper'
