import { keys, type TranslationKey } from './keys'

/** German values, keyed by the typed constants in `keys.ts`. */
export const de: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Wildix',

	[keys.wildixUsersSingular]: 'Wildix-Benutzer',
	[keys.wildixUsersPlural]: 'Wildix-Benutzer',
	[keys.wildixUsersDescUserId]: 'Wildix PBX-Benutzer-ID. Dient als stabiler Sync-Schlüssel.',
	[keys.wildixUsersDescExtension]: 'PBX-Nebenstelle. Bestimmt Anrufe und Gerätezuordnung.',
	[keys.wildixUsersDescDefaultDevice]: 'SIP-Kontakt des Standardgeräts für ausgehende Anrufe.',
	[keys.wildixUsersDescPayloadUser]:
		'Verknüpfung zum Payload-Benutzer. Manuell im API-Key-Modus, automatisch im OAuth2-Modus.',
	[keys.wildixUsersDescAccessToken]: 'OAuth2 Access-Token. Nur im OAuth2-Modus vorhanden.',
	[keys.wildixUsersDescRefreshToken]:
		'OAuth2 Refresh-Token. Wird bei Ablauf automatisch erneuert. Nur im OAuth2-Modus.',
	[keys.wildixUsersDescTokenExpiresAt]: 'Ablauf des Access-Tokens. Nur im OAuth2-Modus vorhanden.',

	[keys.wildixDevicesSingular]: 'Wildix-Gerät',
	[keys.wildixDevicesPlural]: 'Wildix-Geräte',
	[keys.wildixDevicesDescWildixId]: 'Wildix PBX-Geräte-ID. Dient als stabiler Sync-Schlüssel.',
	[keys.wildixDevicesDescContact]:
		'Gerätekennung (MAC-Adresse oder ersatzweise die PBX-Geräte-ID).',
	[keys.wildixDevicesDescUserAgent]:
		'Geräte-User-Agent (Telefonmodell, WebRTC-Client, Mobile-App).',
	[keys.wildixDevicesDescWildixUserId]: 'Wildix PBX-Benutzer-ID, der dieses Gerät gehört.',
	[keys.wildixDevicesDescWildixUser]: 'Verknüpftes Wildix-Benutzerdokument.',
	[keys.wildixDevicesLabelActiveDevice]: 'Aktives Gerät',

	[keys.wildixChannelsSingular]: 'Wildix-Anrufgruppe',
	[keys.wildixChannelsPlural]: 'Wildix-Anrufgruppen',
	[keys.wildixChannelsDescChannelId]: 'Wildix-Anrufgruppen- / Warteschlangen-ID.',
	[keys.wildixChannelsDescAssignedUsers]: 'Dieser Anrufgruppe zugewiesene Mitglieder.',

	[keys.callLogsSingular]: 'Anrufprotokoll',
	[keys.callLogsPlural]: 'Anrufprotokolle',

	[keys.fieldPhoneNumber]: 'Telefonnummer',
	[keys.widgetCallActivity]: 'Anrufaktivität',

	[keys.oauthButtonConnect]: 'Wildix-Konto verbinden',
	[keys.oauthButtonReconnect]: 'Wildix-Konto erneut verbinden',
	[keys.oauthTokenExpired]: 'Deine Wildix-Verbindung ist abgelaufen. Bitte erneut verbinden.',
}
