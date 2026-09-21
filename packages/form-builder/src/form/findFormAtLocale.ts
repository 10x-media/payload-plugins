import type { Payload, PayloadRequest, TypedLocale } from 'payload'
import { FORMS_SLUG } from '../collections/forms'

export type FindFormAtLocaleArgs = {
	payload: Payload
	id: number | string
	/** A clamped locale (see `resolveSubmissionLocale`), never raw visitor input. */
	locale: string
	req?: PayloadRequest
	overrideAccess?: boolean
}

/**
 * Loads a form (depth 0) at `locale` for server work done on a visitor's behalf: validating a
 * submission, running its actions, serving poll results. A host with `localization.fallback: false`
 * would otherwise get empty values for anything the author never filled in at that locale, which
 * sends a blank email or fails `emailTeam` on an empty `to` for every submission in it, so the
 * default locale is passed as an explicit per-field fallback there. A host with fallback enabled
 * keeps Payload's own resolution, locale-specific fallbacks included.
 *
 * Payload's local API writes `locale` and `fallbackLocale` onto the `req` it is handed. Both are
 * restored afterwards, so a host (or job runner) request passed in comes back unchanged.
 */
export const findFormAtLocale = async ({
	payload,
	id,
	locale,
	req,
	overrideAccess,
}: FindFormAtLocaleArgs) => {
	const { localization } = payload.config
	const fallbackLocale =
		localization && !localization.fallback && locale !== localization.defaultLocale
			? localization.defaultLocale
			: undefined
	const previous = req ? { locale: req.locale, fallbackLocale: req.fallbackLocale } : undefined
	try {
		return await payload.findByID({
			collection: FORMS_SLUG,
			id,
			depth: 0,
			// Cast: a clamped locale is one of the host's own codes, but its concrete `TypedLocale` union
			// is unknowable from the plugin.
			locale: locale as TypedLocale,
			...(fallbackLocale ? { fallbackLocale: fallbackLocale as TypedLocale } : {}),
			...(overrideAccess === undefined ? {} : { overrideAccess }),
			req,
		})
	} finally {
		if (req && previous) {
			req.locale = previous.locale
			req.fallbackLocale = previous.fallbackLocale
		}
	}
}
