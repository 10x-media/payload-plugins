import { jsLiteral } from '../../capture/jsLiteral'
import { EXCLUSION_STORAGE_KEY } from '../../tracker/exclusion'

/**
 * GA4's kill switch, `window['ga-disable-<id>'] = true`: honoured only when set before the page's
 * first `gtag()` call (https://developers.google.com/tag-platform/security/guides/privacy).
 */
export const GA4_DISABLE_PREFIX = 'ga-disable-'

/** The switch's property name for one measurement id. */
export const ga4DisableKey = (measurementId: string): string =>
	`${GA4_DISABLE_PREFIX}${measurementId}`

/**
 * Runs ahead of the snippet's first `gtag()` call, the only place the switch counts: the tracker
 * boots too late for a server-rendered snippet. Guarded, since storage can be blocked.
 */
export const ga4ExcludeGuard = (measurementId: string): string =>
	`try{if(localStorage.getItem(${jsLiteral(EXCLUSION_STORAGE_KEY)})==="1")window[${jsLiteral(ga4DisableKey(measurementId))}]=true}catch(e){}`
