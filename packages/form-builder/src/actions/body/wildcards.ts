import type { SubmissionDescriptor, SubmissionValue } from '../../submissions/types'
import { escapeHtml } from './escapeHtml'

type Row = { label: string; value: string }

const displayValue = (value: unknown, descriptor?: SubmissionDescriptor): string => {
	if (value == null) {
		return ''
	}
	if (Array.isArray(value)) {
		return value.map((entry) => displayValue(entry, descriptor)).join(', ')
	}
	const raw = typeof value === 'object' ? JSON.stringify(value) : String(value)
	return descriptor?.optionLabels?.[raw] ?? raw
}

/**
 * Descriptors are the submit-time snapshot of real form fields, so when present they gate which
 * values render (internal keys like the honeypot never get a descriptor). Legacy rows without
 * descriptors fall back to rendering every value under its field name.
 */
const rowsOf = (values: SubmissionValue[], descriptors: SubmissionDescriptor[]): Row[] => {
	const byField = new Map(descriptors.map((descriptor) => [descriptor.field, descriptor]))
	const included = byField.size > 0 ? values.filter((value) => byField.has(value.field)) : values
	return included.map((entry) => {
		const descriptor = byField.get(entry.field)
		return { label: descriptor?.label ?? entry.field, value: displayValue(entry.value, descriptor) }
	})
}

/** All answers as HTML-escaped `Label: value` lines joined with `<br />`. */
export const renderAllValues = (
	values: SubmissionValue[],
	descriptors: SubmissionDescriptor[]
): string =>
	rowsOf(values, descriptors)
		.map((row) => `${escapeHtml(row.label)}: ${escapeHtml(row.value)}`)
		.join('<br />')

/** All answers as a simple HTML-escaped two-column table. */
export const renderAllValuesTable = (
	values: SubmissionValue[],
	descriptors: SubmissionDescriptor[]
): string => {
	const rows = rowsOf(values, descriptors)
		.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${escapeHtml(row.value)}</td></tr>`)
		.join('')
	return `<table><tbody>${rows}</tbody></table>`
}
