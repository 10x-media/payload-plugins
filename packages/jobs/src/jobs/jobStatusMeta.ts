import { keys, type TranslationKey } from '../translations/keys'
import type { JobStatus } from './deriveJobStatus'

/** Payload `Pill` styles used for job statuses. */
export type JobStatusPillStyle =
	| 'dark'
	| 'error'
	| 'light'
	| 'light-gray'
	| 'success'
	| 'warning'
	| 'white'

/**
 * Translation key and native Pill style per status, shared by the list cell,
 * document header, and health bar so the three never drift. Kept as plain data
 * (no React) so the server-rendered health bar can import it.
 */
export const jobStatusMeta: Record<
	JobStatus,
	{ labelKey: TranslationKey; pillStyle: JobStatusPillStyle }
> = {
	queued: { labelKey: keys.statusQueued, pillStyle: 'light' },
	scheduled: { labelKey: keys.statusScheduled, pillStyle: 'light-gray' },
	retrying: { labelKey: keys.statusRetrying, pillStyle: 'warning' },
	running: { labelKey: keys.statusRunning, pillStyle: 'dark' },
	succeeded: { labelKey: keys.statusSucceeded, pillStyle: 'success' },
	failed: { labelKey: keys.statusFailed, pillStyle: 'error' },
	cancelled: { labelKey: keys.statusCancelled, pillStyle: 'white' },
}
