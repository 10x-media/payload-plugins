import type { Option } from 'payload'
import { isValidElement } from 'react'
import { isRecord } from '../../core/values'
import { type FallbackLanguage, pickLabel } from '../../translations/labelMap'

/**
 * Resolves an `Option` whose label may be a per-locale map to plain text: current locale, then
 * the install's fallback language, then English, then the raw value.
 */
export const toSelectOption = (
	option: Option,
	locale: string,
	fallbackLanguage?: FallbackLanguage
): { label: string; value: string } => {
	if (typeof option === 'string') return { label: option, value: option }
	const { label, value } = option
	if (typeof label === 'string') return { label, value }
	return { label: pickLabel(labelMapOf(label), locale, fallbackLanguage) ?? value, value }
}

/** A label given per language; a component or a label function has no text to pick here. */
const labelMapOf = (label: unknown): Record<string, string> | undefined => {
	if (!isRecord(label) || isValidElement(label)) {
		return undefined
	}
	const entries = Object.entries(label).flatMap(([language, text]) =>
		typeof text === 'string' ? [[language, text] as const] : []
	)
	return Object.fromEntries(entries)
}
