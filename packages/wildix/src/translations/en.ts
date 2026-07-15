import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Wildix',

	[keys.wildixUsersSingular]: 'Wildix User',
	[keys.wildixUsersPlural]: 'Wildix Users',
	[keys.wildixUsersDescUserId]: 'Wildix PBX user id. Used as the stable sync key.',
	[keys.wildixUsersDescExtension]: 'PBX extension. Used to scope dialing and device lookups.',
	[keys.wildixUsersDescDefaultDevice]: 'SIP contact of the default device used for outbound calls.',
	[keys.wildixUsersDescPayloadUser]:
		'Links to the Payload user. Set manually in API-key mode; automatic in OAuth2 mode.',
	[keys.wildixUsersDescAccessToken]: 'OAuth2 access token. Only present in OAuth2 mode.',
	[keys.wildixUsersDescRefreshToken]:
		'OAuth2 refresh token. Auto-refreshed on expiry. Only present in OAuth2 mode.',
	[keys.wildixUsersDescTokenExpiresAt]: 'Access token expiry. Only present in OAuth2 mode.',

	[keys.wildixDevicesSingular]: 'Wildix Device',
	[keys.wildixDevicesPlural]: 'Wildix Devices',
	[keys.wildixDevicesDescContact]: 'SIP contact URI identifying the device.',
	[keys.wildixDevicesDescUserAgent]: 'Device user agent (phone model, WebRTC client, mobile app).',
	[keys.wildixDevicesDescWildixUserId]: 'Wildix PBX user id owning this device.',
	[keys.wildixDevicesDescWildixUser]: 'Linked Wildix user document.',
	[keys.wildixDevicesLabelActiveDevice]: 'Active device',

	[keys.wildixChannelsSingular]: 'Wildix Call Group',
	[keys.wildixChannelsPlural]: 'Wildix Call Groups',
	[keys.wildixChannelsDescChannelId]: 'Wildix call group / queue id.',
	[keys.wildixChannelsDescAssignedUsers]: 'Members assigned to this call group.',

	[keys.callLogsSingular]: 'Call Log',
	[keys.callLogsPlural]: 'Call Logs',

	[keys.fieldPhoneNumber]: 'Phone Number',
	[keys.widgetCallActivity]: 'Call Activity',

	[keys.oauthButtonConnect]: 'Connect Wildix account',
	[keys.oauthButtonReconnect]: 'Reconnect Wildix account',
	[keys.oauthTokenExpired]: 'Your Wildix connection expired. Please reconnect.',
}
