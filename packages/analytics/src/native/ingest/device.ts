export type DeviceType = 'desktop' | 'mobile' | 'tablet'

/**
 * Coarse device class from a user-agent string. Tablets are checked before phones
 * because an Android tablet UA lacks the `Mobile` token an Android phone carries.
 */
export const classifyDevice = (ua: string): DeviceType => {
	const s = ua.toLowerCase()
	if (/ipad|tablet|playbook|silk|kindle/.test(s) || (/android/.test(s) && !/mobi/.test(s))) {
		return 'tablet'
	}
	if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini|windows phone/.test(s)) {
		return 'mobile'
	}
	return 'desktop'
}
