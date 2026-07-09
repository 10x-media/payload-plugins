/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`), or it is a type error.
 */
export const keys = {
	pluginName: 'jobs:pluginName',

	statusQueued: 'jobs:statusQueued',
	statusScheduled: 'jobs:statusScheduled',
	statusRetrying: 'jobs:statusRetrying',
	statusRunning: 'jobs:statusRunning',
	statusSucceeded: 'jobs:statusSucceeded',
	statusFailed: 'jobs:statusFailed',
	statusCancelled: 'jobs:statusCancelled',

	fieldStatus: 'jobs:fieldStatus',
	fieldWorkflow: 'jobs:fieldWorkflow',
	fieldTask: 'jobs:fieldTask',
	fieldJob: 'jobs:fieldJob',
	fieldQueue: 'jobs:fieldQueue',
	fieldAttempts: 'jobs:fieldAttempts',
	fieldCreated: 'jobs:fieldCreated',
	fieldUpdated: 'jobs:fieldUpdated',
	fieldCompleted: 'jobs:fieldCompleted',
	fieldExecuted: 'jobs:fieldExecuted',
	fieldTaskId: 'jobs:fieldTaskId',
	fieldInput: 'jobs:fieldInput',
	fieldOutput: 'jobs:fieldOutput',
	fieldError: 'jobs:fieldError',
	fieldId: 'jobs:fieldId',
	fieldStarted: 'jobs:fieldStarted',
	fieldLeaseExpires: 'jobs:fieldLeaseExpires',
	fieldScheduledFor: 'jobs:fieldScheduledFor',

	outcome: 'jobs:outcome',
	noAttempts: 'jobs:noAttempts',
	copy: 'jobs:copy',
	copied: 'jobs:copied',
	jobSingular: 'jobs:jobSingular',
	jobPlural: 'jobs:jobPlural',
	errorWorkflowTaskExclusive: 'jobs:errorWorkflowTaskExclusive',
	cronBadge: 'jobs:cronBadge',
	attemptsTooltip: 'jobs:attemptsTooltip',
	inlineStep: 'jobs:inlineStep',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
