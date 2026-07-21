/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`, `de.ts`), or it is a type error.
 */
export const keys = {
	pluginName: 'wildix:pluginName',

	wildixUsersSingular: 'wildix:wildixUsersSingular',
	wildixUsersPlural: 'wildix:wildixUsersPlural',
	wildixUsersDescUserId: 'wildix:wildixUsersDescUserId',
	wildixUsersDescExtension: 'wildix:wildixUsersDescExtension',
	wildixUsersDescDefaultDevice: 'wildix:wildixUsersDescDefaultDevice',
	wildixUsersDescPayloadUser: 'wildix:wildixUsersDescPayloadUser',
	wildixUsersDescAccessToken: 'wildix:wildixUsersDescAccessToken',
	wildixUsersDescRefreshToken: 'wildix:wildixUsersDescRefreshToken',
	wildixUsersDescTokenExpiresAt: 'wildix:wildixUsersDescTokenExpiresAt',

	wildixDevicesSingular: 'wildix:wildixDevicesSingular',
	wildixDevicesPlural: 'wildix:wildixDevicesPlural',
	wildixDevicesDescWildixId: 'wildix:wildixDevicesDescWildixId',
	wildixDevicesDescContact: 'wildix:wildixDevicesDescContact',
	wildixDevicesDescUserAgent: 'wildix:wildixDevicesDescUserAgent',
	wildixDevicesDescWildixUserId: 'wildix:wildixDevicesDescWildixUserId',
	wildixDevicesDescWildixUser: 'wildix:wildixDevicesDescWildixUser',
	wildixDevicesLabelActiveDevice: 'wildix:wildixDevicesLabelActiveDevice',

	wildixChannelsSingular: 'wildix:wildixChannelsSingular',
	wildixChannelsPlural: 'wildix:wildixChannelsPlural',
	wildixChannelsDescChannelId: 'wildix:wildixChannelsDescChannelId',
	wildixChannelsDescAssignedUsers: 'wildix:wildixChannelsDescAssignedUsers',

	callLogsSingular: 'wildix:callLogsSingular',
	callLogsPlural: 'wildix:callLogsPlural',

	fieldPhoneNumber: 'wildix:fieldPhoneNumber',
	widgetCallActivity: 'wildix:widgetCallActivity',

	oauthButtonConnect: 'wildix:oauthButtonConnect',
	oauthButtonReconnect: 'wildix:oauthButtonReconnect',
	oauthTokenExpired: 'wildix:oauthTokenExpired',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
