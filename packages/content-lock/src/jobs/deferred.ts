import type { JobsRegistry } from '@10x-media/jobs'
import type { Config, Payload } from 'payload'

const JOBS_KEY = '@10x-media/jobs'

/** Jobs a window defers are tagged `content-lock:<window id>`. */
export const DEFERRED_PREFIX = 'content-lock:'

export const deferredByWindow = (windowId: string | null | undefined): string =>
	`${DEFERRED_PREFIX}${windowId ?? 'unknown'}`

/** The jobs plugin's registry, when it is installed. */
export const jobsRegistryOf = (config: Pick<Config, 'custom'>): JobsRegistry | undefined => {
	const registry = config.custom?.[JOBS_KEY] as JobsRegistry | undefined
	return Array.isArray(registry?.extensions?.runGates) ? registry : undefined
}

/**
 * Release the jobs one window deferred, after any change to it: "End now" or
 * a moved end frees them within one worker tick instead of at the old end.
 * Early is safe: a job that still hits a lock is deferred again. Never throws.
 */
export const resumeWindowJobs = async (
	payload: Payload,
	windowId: number | string
): Promise<void> => {
	const registry = jobsRegistryOf(payload.config)
	if (!registry) {
		return
	}
	try {
		await registry.api.resumeDeferred(payload, deferredByWindow(String(windowId)))
	} catch (error) {
		payload.logger.error({ err: error, msg: '[content-lock] cannot resume deferred jobs' })
	}
}
