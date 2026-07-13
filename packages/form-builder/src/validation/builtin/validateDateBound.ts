import type { PayloadRequest } from 'payload'
import { isValidCalendarDate } from '../../fields/builtin/date'
import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'

/**
 * Field-level `validate` for a minDate/maxDate rule's bound param: an unset bound is tolerated
 * (the rule itself already treats a missing bound as pass-through), otherwise it must be a real
 * `YYYY-MM-DD` calendar date so the rule's string comparison against submitted values is meaningful.
 * Exported for unit testing.
 */
export const validateDateBound = (
	value: unknown,
	{ req }: { data?: unknown; req: PayloadRequest }
): string | true => {
	if (typeof value !== 'string' || value === '') {
		return true
	}
	return isValidCalendarDate(value) ? true : asTranslate(req.t)(keys.validationDate)
}
