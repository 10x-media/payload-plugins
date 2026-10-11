export type DeviceType = 'desktop' | 'mobile' | 'tablet'

/**
 * User agent stamped on server events with no browser request behind them; they abstain from the
 * device breakdown rather than piling into `desktop`.
 */
export const SERVER_USER_AGENT = 'analytics-server'

/**
 * Coarse device class, undefined for the server agent. Tablets are checked first because an
 * Android tablet UA lacks the `Mobile` token an Android phone carries.
 */
export const classifyDevice = (ua: string): DeviceType | undefined => {
	if (ua === SERVER_USER_AGENT) {
		return undefined
	}
	const s = ua.toLowerCase()
	if (/ipad|tablet|playbook|silk|kindle/.test(s) || (/android/.test(s) && !/mobi/.test(s))) {
		return 'tablet'
	}
	if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini|windows phone/.test(s)) {
		return 'mobile'
	}
	return 'desktop'
}
