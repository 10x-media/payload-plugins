import { keys } from '../../translations/keys'
import { defineFormField } from '../defineFormField'

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** True calendar-date check for `YYYY-MM-DD` strings (rejects e.g. `2024-02-30`). */
export const isValidCalendarDate = (value: string): boolean => {
	const match = DATE_PATTERN.exec(value)
	if (!match) {
		return false
	}
	const [, yearStr, monthStr, dayStr] = match
	const year = Number(yearStr)
	const month = Number(monthStr)
	const day = Number(dayStr)
	const date = new Date(Date.UTC(year, month - 1, day))
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	)
}

/** `placeholder` is omitted: browsers ignore it on `<input type="date">`, which renders its own picker. */
export const dateField = defineFormField<'date'>({
	type: 'date',
	label: keys.fieldTypeDate,
	value: 'date',
	omitShared: ['placeholder'],
	validate: ({ value, t }) => {
		if (value == null || value === '') {
			return true
		}
		return isValidCalendarDate(value) ? true : t(keys.validationDate)
	},
	format: ({ value }) => (value == null ? '' : String(value)),
})
