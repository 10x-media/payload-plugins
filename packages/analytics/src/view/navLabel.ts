import { type FallbackLanguage, pickLabel } from '../translations/labelMap'

/** A blank override is an unset one: an empty nav entry is worse than the default label. */
const usable = (value: string | undefined): string | undefined =>
	value && value.trim() !== '' ? value : undefined

export interface NavLabelArgs {
	/** `view.navLabel`: a plain string, or a map keyed by admin language code. */
	label?: string | Record<string, string>
	language: string
	/** Payload's `i18n.fallbackLanguage`, which a map is read in after the reader's language. */
	fallbackLanguage?: FallbackLanguage
	/** The plugin's own translated label, used when the override says nothing usable. */
	fallback: string
}

/**
 * Analytics entry label: a map falls back to install fallback language, then `en`, then plugin's
 * translation. Nav link and breadcrumb both resolve here so they cannot drift.
 */
export const resolveNavLabel = ({
	label,
	language,
	fallbackLanguage,
	fallback,
}: NavLabelArgs): string => {
	const override =
		typeof label === 'string' ? usable(label) : pickLabel(label, language, fallbackLanguage)
	return override ?? fallback
}
