import { isRecord } from '../core/values'

const isLocaleMap = (value: unknown): value is Record<string, string> =>
	isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')

/** Admin placeholders are a plain string or a locale map; an input wants one string. */
export const resolvePlaceholder = (placeholder: unknown, locale: string): string | undefined => {
	if (typeof placeholder === 'string') {
		return placeholder
	}
	return isLocaleMap(placeholder) ? (placeholder[locale] ?? placeholder.en) : undefined
}
