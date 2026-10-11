import type { Config, Payload, SanitizedConfig } from 'payload'

import type { WrapPlan } from './wrap'

/** Where the jobs plugin keeps its extension registry on `config.custom`. */
export const JOBS_CUSTOM_KEY = '@10x-media/jobs'

/**
 * A run gate's verdict for one tick. `null` means no opinion. `paused: 'all'`
 * acts as a global pause, a list pauses those queues. `until` is the gate's
 * best guess of when the pause ends, and `by` names who paused.
 */
export type RunGateResult = {
	paused: 'all' | string[]
	until?: Date | null
	by?: string
} | null

/**
 * Consulted by the plugin's worker and `queue-run` before every run, on top of
 * the manual pause. A gate never writes the pause store, so lifting one never
 * clears a pause an operator set.
 */
export type RunGate = (args: { payload: Payload }) => RunGateResult | Promise<RunGateResult>

/** Why a running job stopped and when it may run again. */
export type Interruption = { until: Date; by: string }

/**
 * Recognises an error thrown by a job handler as an interruption rather than a
 * failure. Return `null` for errors it does not own.
 */
export type InterruptClassifier = (args: {
	error: unknown
	payload: Payload
}) => Interruption | null

/** Extension points other plugins append to at config time. */
export type JobsExtensions = {
	runGates: RunGate[]
	interruptOn: InterruptClassifier[]
}

/** Runtime helpers other plugins call without importing this package. */
export type JobsApi = {
	/** Release jobs deferred by `by` now instead of at their `waitUntil`. */
	resumeDeferred: (payload: Payload, by: string) => Promise<{ resumed: number }>
}

/**
 * The registry at `config.custom['@10x-media/jobs']`. The jobs plugin creates
 * it; a plugin ordered after it appends to `extensions`. `plan` is internal.
 */
export type JobsRegistry = {
	extensions: JobsExtensions
	api: JobsApi
	plan: WrapPlan
}

type WithCustom = Pick<Config, 'custom'> | Pick<SanitizedConfig, 'custom'>

/** The registry on a config, or `undefined` when the jobs plugin is not installed. */
export const jobsRegistryOf = (config: WithCustom): JobsRegistry | undefined => {
	const registry = config.custom?.[JOBS_CUSTOM_KEY] as JobsRegistry | undefined
	return registry && Array.isArray(registry.extensions?.runGates) ? registry : undefined
}
