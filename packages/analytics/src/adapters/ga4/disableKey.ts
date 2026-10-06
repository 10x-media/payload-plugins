import { EXCLUSION_STORAGE_KEY } from '../../tracker/exclusion'

/**
 * GA4's own kill switch: `window['ga-disable-<measurementId>'] = true` stops the tag sending
 * anything (https://developers.google.com/tag-platform/security/guides/privacy).
 */
export const GA4_DISABLE_PREFIX = 'ga-disable-'

/** The switch's property name for one measurement id. */
export const ga4DisableKey = (measurementId: string): string =>
	`${GA4_DISABLE_PREFIX}${measurementId}`

/**
 * The statement the snippet runs before its first `gtag()` call. Google honours the switch
 * only ahead of that call and the property does not survive a page load, so the rendered
 * snippet has to read the exclusion flag itself: the tracker's own effect runs after the
 * snippet has already queued `gtag('config', ...)`. Storage can be blocked, and a snippet
 * that threw would take the rest of the inline with it.
 */
export const ga4ExcludeGuard = (measurementId: string): string =>
	`try{if(localStorage.getItem(${JSON.stringify(EXCLUSION_STORAGE_KEY)})==="1")window[${JSON.stringify(ga4DisableKey(measurementId))}]=true}catch(e){}`
