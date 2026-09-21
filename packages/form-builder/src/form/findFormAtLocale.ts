import type { Payload, PayloadRequest, SanitizedConfig, TypedLocale } from 'payload'
import type { SubmissionForm } from '../actions/submissionContext'
import { FORMS_SLUG } from '../collections/forms'
import { customStateOf, stashCustomState } from '../plugin/customState'

/** What a `fallbackLocale` resolver returns: a locale code, an ordered list of codes, `false` for no fallback, or `undefined` to keep the default. */
export type FormFallbackLocaleResult = string | string[] | false | undefined

export type FormFallbackLocaleArgs = {
	/**
	 * The form as first read at `locale` with the default fallback, at depth 0: a non-localized owner
	 * relationship (a multi-tenant host's `form.tenant`) is already on it, so no read of your own is needed.
	 */
	form: SubmissionForm
	/** The locale the form is being read at (the submission's, clamped). */
	locale: string
	payload: Payload
	req?: PayloadRequest
}

/**
 * Host seam choosing the fallback locale per form (plugin option `fallbackLocale`), for hosts where
 * the right fallback depends on the form's owner rather than on the config, e.g. a tenant whose own
 * default locale is not the config-wide one. Runs before the plugin acts on a form server-side
 * (validating a submission, running its actions, serving poll results).
 */
export type FormFallbackLocale = (
	args: FormFallbackLocaleArgs
) => Promise<FormFallbackLocaleResult> | FormFallbackLocaleResult

type FallbackState = { fallbackLocale?: FormFallbackLocale }

export const stashFallbackLocale = (
	custom: Record<string, unknown> | undefined,
	fallbackLocale: FormFallbackLocale
): Record<string, unknown> => stashCustomState<FallbackState>(custom, { fallbackLocale })

export type FindFormAtLocaleArgs = {
	payload: Payload
	id: number | string
	/** A clamped locale (see `resolveSubmissionLocale`), never raw visitor input. */
	locale: string
	req?: PayloadRequest
	overrideAccess?: boolean
}

type Localization = Exclude<SanitizedConfig['localization'], false>

/**
 * The fallback a default read applies: Payload's own resolution (a locale's `fallbackLocale`, else
 * the default locale) with fallback enabled; otherwise the default locale, passed explicitly so
 * content the author never filled in at `locale` is not read as empty.
 */
const defaultFallbackOf = (localization: Localization, locale: string): string | undefined => {
	if (locale === localization.defaultLocale) {
		return undefined
	}
	if (!localization.fallback) {
		return localization.defaultLocale
	}
	const own = localization.locales.find((entry) => entry.code === locale)?.fallbackLocale
	return typeof own === 'string' ? own : localization.defaultLocale
}

/**
 * Loads a form (depth 0) at `locale` for server work done on a visitor's behalf: validating a
 * submission, running its actions, serving poll results. A host with `localization.fallback: false`
 * would otherwise get empty values for anything the author never filled in at that locale, which
 * sends a blank email or fails `emailTeam` on an empty `to` for every submission in it, so the
 * default locale is passed as an explicit per-field fallback there. A host with fallback enabled
 * keeps Payload's own resolution, locale-specific fallbacks included.
 *
 * With the plugin's `fallbackLocale` resolver set, it gets the form as read and may choose another
 * fallback; the form is read again only when that differs from the one already applied.
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
	const read = (fallbackLocale: string | string[] | false | undefined) =>
		payload.findByID({
			collection: FORMS_SLUG,
			id,
			depth: 0,
			// Cast: a clamped locale is one of the host's own codes, but its concrete `TypedLocale` union
			// is unknowable from the plugin.
			locale: locale as TypedLocale,
			...(fallbackLocale === undefined ? {} : { fallbackLocale: fallbackLocale as TypedLocale }),
			...(overrideAccess === undefined ? {} : { overrideAccess }),
			req,
		})
	const previous = req ? { locale: req.locale, fallbackLocale: req.fallbackLocale } : undefined
	try {
		if (!localization) {
			return await read(undefined)
		}
		const applied = defaultFallbackOf(localization, locale)
		// With fallback enabled Payload already applies `applied` on its own; only a disabled one needs it explicitly.
		const form = await read(localization.fallback ? undefined : applied)
		const resolver = customStateOf<FallbackState>(payload).fallbackLocale
		if (!resolver) {
			return form
		}
		const chosen = await resolver({
			// Double cast: a host's generated Form interface has no index signature.
			form: form as unknown as SubmissionForm,
			locale,
			payload,
			req,
		})
		// Falling back to the read's own locale, or to the fallback already applied, changes nothing.
		if (chosen === undefined || chosen === locale || chosen === (applied ?? false)) {
			return form
		}
		return await read(chosen)
	} finally {
		if (req && previous) {
			req.locale = previous.locale
			req.fallbackLocale = previous.fallbackLocale
		}
	}
}
