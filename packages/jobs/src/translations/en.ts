import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Jobs',

	[keys.statusQueued]: 'Queued',
	[keys.statusScheduled]: 'Scheduled',
	[keys.statusRetrying]: 'Retrying',
	[keys.statusRunning]: 'Running',
	[keys.statusSucceeded]: 'Succeeded',
	[keys.statusFailed]: 'Failed',
	[keys.statusCancelled]: 'Cancelled',

	[keys.fieldStatus]: 'Status',
	[keys.fieldWorkflow]: 'Workflow',
	[keys.fieldTask]: 'Task',
	[keys.fieldJob]: 'Job',
	[keys.fieldQueue]: 'Queue',
	[keys.fieldAttempts]: 'Attempts',
	[keys.fieldCreated]: 'Created',
	[keys.fieldUpdated]: 'Updated',
	[keys.fieldCompleted]: 'Completed',
	[keys.fieldExecuted]: 'Executed',
	[keys.fieldTaskId]: 'Task ID',
	[keys.fieldInput]: 'Input',
	[keys.fieldOutput]: 'Output',
	[keys.fieldError]: 'Error',
	[keys.fieldId]: 'ID',
	[keys.fieldStarted]: 'Started',
	[keys.fieldLeaseExpires]: 'Lease expires',
	[keys.fieldScheduledFor]: 'Scheduled for',

	[keys.outcome]: 'Outcome',
	[keys.noAttempts]: 'No attempts recorded yet.',
	[keys.copy]: 'Copy',
	[keys.copied]: 'Copied',
	[keys.jobSingular]: 'job',
	[keys.jobPlural]: 'jobs',
	[keys.errorWorkflowTaskExclusive]: 'A job runs a workflow or a task, not both.',
}
