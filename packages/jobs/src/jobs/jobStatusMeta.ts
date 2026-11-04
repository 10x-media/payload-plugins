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
 * Class that turns a Pill green with Payload's success tokens. Payload's own
 * `success` Pill style is its selected blue, which marks a running job here.
 */
export const SUCCESS_PILL_CLASS = 'jobs-pill--success'

/**
 * Translation key, native Pill style, and optional extra class per status, shared by the list cell,
 * document header, and health bar so the three never drift. Kept as plain data
 * (no React) so the server-rendered health bar can import it.
 */
export const jobStatusMeta: Record<
	JobStatus,
	{ className?: string; labelKey: TranslationKey; pillStyle: JobStatusPillStyle }
> = {
	queued: { labelKey: keys.statusQueued, pillStyle: 'light' },
	scheduled: { labelKey: keys.statusScheduled, pillStyle: 'light-gray' },
	retrying: { labelKey: keys.statusRetrying, pillStyle: 'warning' },
	running: { labelKey: keys.statusRunning, pillStyle: 'success' },
	succeeded: {
		className: SUCCESS_PILL_CLASS,
		labelKey: keys.statusSucceeded,
		pillStyle: 'light',
	},
	failed: { labelKey: keys.statusFailed, pillStyle: 'error' },
	cancelled: { labelKey: keys.statusCancelled, pillStyle: 'white' },
}
