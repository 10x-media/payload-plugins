import { keys, type TranslationKey } from '../translations/keys'
import type { WidgetReadStatus } from './prepareWidgetRead'

/**
 * What a widget says instead of its numbers, one wording for every widget. Total over the status
 * union, so a status cannot be added without every widget answering for it.
 */
export const WIDGET_STATE_KEYS: Record<Exclude<WidgetReadStatus, 'ok'>, TranslationKey> = {
	'not-configured': keys.stateNotConfigured,
	unavailable: keys.stateUnavailable,
	busy: keys.viewErrorBusy,
	invalid: keys.viewErrorInvalid,
	'range-too-long': keys.stateRangeTooLong,
	'filter-unsupported': keys.stateFilterUnsupported,
	'no-access': keys.viewNoAccess,
	'no-scope': keys.stateNoScope,
	misconfigured: keys.viewErrorMisconfigured,
	'host-refused': keys.viewErrorHostRefused,
}

/**
 * What an empty goal list says: the source could not answer about the goals, the scope configures
 * none (a setup step), or nobody converted. The plain wording would read every case as the last.
 */
export const emptyGoalsKey = (read: {
	goalsUnresolved?: boolean | undefined
	noGoals?: boolean | undefined
}): TranslationKey => {
	if (read.goalsUnresolved) {
		return keys.stateGoalsUnresolved
	}
	return read.noGoals ? keys.stateNoGoals : keys.stateNoBreakdown
}
