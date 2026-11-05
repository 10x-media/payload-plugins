import { keys, type TranslationKey } from '../translations/keys'
import type { FieldReadStatus } from './readForDocument'

/** What a display field says instead of its numbers; stat field and panel share the wording. */
export const FIELD_STATE_KEYS: Record<Exclude<FieldReadStatus, 'ok'>, TranslationKey> = {
	'no-path': keys.stateNoData,
	'not-bound': keys.stateNotBound,
	'not-configured': keys.stateNotConfigured,
	'no-access': keys.stateNoAccess,
	'no-scope': keys.stateNoScope,
	unavailable: keys.stateUnavailable,
	busy: keys.viewErrorBusy,
	invalid: keys.viewErrorInvalid,
	'range-too-long': keys.stateRangeTooLong,
	misconfigured: keys.viewErrorMisconfigured,
	'host-refused': keys.viewErrorHostRefused,
}
