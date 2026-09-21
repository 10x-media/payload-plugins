import {
	type Payload,
	type PayloadRequest,
	sanitizeFallbackLocale,
	type TypedFallbackLocale,
	type TypedLocale,
} from 'payload'
import type { SubmissionForm } from '../actions/submissionContext'
import { FORMS_SLUG } from '../collections/forms'
import { customStateOf, stashCustomState } from '../plugin/customState'

/**
 * What a `fallbackLocale` resolver returns: a locale code, an ordered list of codes, `false` for no
 * fallback, or `undefined` to keep the default.
 */
export type FormFallbackLocaleResult = string | string[] | false | undefined

export type FormFallbackLocaleArgs = {
	/**
	 * The form as first read at `locale` with the config's own fallback, at depth 0: a non-localized
	 * owner relationship (a multi-tenant host's `form.tenant`) is already on it, so no read of your own
	 * is needed. Decide from non-localized fields: a localized one may be empty at `locale`.
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

/**
 * A host `fallbackLocale` resolver threw. Kept distinct so callers that read a failed form load as a
 * deleted form (and skip quietly) let this one through instead: a transient failure in host I/O must
 * fail the action run (and retry it on the queued path), never drop it.
 */
export class FallbackLocaleError extends Error {
	constructor(cause: unknown) {
		super(
			`@10x-media/form-builder: fallbackLocale resolver failed: ${
				cause instanceof Error ? cause.message : String(cause)
			}`,
			{ cause }
		)
		this.name = 'FallbackLocaleError'
	}
}

/**
 * `.catch` handler for callers that treat a form that cannot be read as missing: `null` for a read
 * failure, rethrowing a `FallbackLocaleError`.
 */
export const missingFormOnReadError = (error: unknown): null => {
	if (error instanceof FallbackLocaleError) {
		throw error
	}
	return null
}

/**
 * Loads a form (depth 0) at `locale` for server work done on a visitor's behalf: validating a
 * submission, running its actions, serving poll results. The read falls back exactly like any other
 * Payload read, so with `localization.fallback: false` content the author never filled in at
 * `locale` stays empty, matching what the host's own page renders.
 *
 * With the plugin's `fallbackLocale` resolver set, it gets the form as read and may choose another
 * fallback (the way a host forces one); the form is read again only when that differs from the one
 * already applied.
 *
 * Payload's local API writes `locale` and `fallbackLocale` onto the `req` it is handed. Both are
 * restored afterwards, so a host (or job runner) request passed in comes back unchanged. The restore
 * assumes one operation per `req` at a time: concurrent reads sharing a `req` (a `Promise.all` of
 * creates at different locales) can interleave it, so give each its own request.
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
		const form = await read(undefined)
		const resolver = customStateOf<FallbackState>(payload).fallbackLocale
		if (!resolver) {
			return form
		}
		let chosen: FormFallbackLocaleResult
		try {
			chosen = await resolver({
				// Double cast: a host's generated Form interface has no index signature.
				form: form as unknown as SubmissionForm,
				locale,
				payload,
				req,
			})
		} catch (error) {
			throw new FallbackLocaleError(error)
		}
		// Falling back to the read's own locale, or to the fallback Payload already applied (resolved by
		// Payload's own sanitizer, so the two cannot drift), changes nothing.
		const applied = sanitizeFallbackLocale({
			fallbackLocale: undefined as unknown as TypedFallbackLocale,
			locale,
			localization,
		})
		if (chosen === undefined || chosen === locale || chosen === applied) {
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
