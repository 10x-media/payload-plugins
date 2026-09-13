export type DeviceType = 'desktop' | 'mobile' | 'tablet'

/**
 * The user agent server-side tracking stamps when the event has no browser request behind
 * it. There is no device to report, so events carrying it abstain from the device breakdown
 * rather than piling into `desktop` and skewing it.
 */
export const SERVER_USER_AGENT = 'analytics-server'

/**
 * Coarse device class from a user-agent string, or undefined when the agent is not a device
 * at all. Tablets are checked before phones because an Android tablet UA lacks the `Mobile`
 * token an Android phone carries.
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
