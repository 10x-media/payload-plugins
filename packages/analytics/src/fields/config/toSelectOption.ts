import type { Option } from 'payload'

/**
 * Static select options in this plugin carry per-locale label maps
 * (Record<string, string>) from registerWidgets. Resolve an `Option` to a
 * plain `{ value, label }` pair for the current locale, falling back to
 * English, then to the raw value.
 */
export const toSelectOption = (
	option: Option,
	locale: string
): { label: string; value: string } => {
	if (typeof option === 'string') return { label: option, value: option }
	const { label, value } = option
	if (typeof label === 'string') return { label, value }
	const map = label as Record<string, string> | undefined
	return { label: map?.[locale] ?? map?.en ?? value, value }
}
