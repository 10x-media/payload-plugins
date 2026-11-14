import type { TextFieldSingleValidation } from 'payload'
import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'

/** Segments of letters, digits, dots and hyphens in any script, slash-separated for a subfolder site. */
const SITE_DOMAIN_PATTERN = /^[\p{L}\p{N}.-]+(?:\/[\p{L}\p{N}.-]+)*$/u

/**
 * A Plausible site as Plausible stores it: lowercase, without a scheme, `www.` or a trailing slash,
 * a subfolder site with its path (`example.com/blog`). Plausible's own form strips the rest, so a
 * pasted address saves here but every read answers "Invalid API key or site ID". Empty is allowed:
 * the field is optional.
 */
export const validateSiteDomain: TextFieldSingleValidation = (value, { req }) => {
	const site = value?.trim()
	return !site ||
		(SITE_DOMAIN_PATTERN.test(site) && site === site.toLowerCase() && !site.startsWith('www.'))
		? true
		: asTranslate(req.t)(keys.providerErrorSiteDomain)
}

/**
 * The Website address the tracker sends to: one site, or several separated by commas, each counting
 * the pageview on its own dashboard. Each one follows {@link validateSiteDomain}.
 */
export const validateSiteDomains: TextFieldSingleValidation = (value, args) => {
	if (!value?.trim()) {
		return true
	}
	for (const site of value.split(',')) {
		const valid = site.trim() !== '' && validateSiteDomain(site, args)
		if (valid !== true) {
			return valid || asTranslate(args.req.t)(keys.providerErrorSiteDomain)
		}
	}
	return true
}
