import { keys, type TranslationKey } from './keys'

export const de: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Sipgate',

	// CallLogs
	[keys.callLogsSingular]: 'Anrufprotokoll',
	[keys.callLogsPlural]: 'Anrufprotokolle',

	// SipgateUsers
	[keys.sipgateUsersSingular]: 'Sipgate-Benutzer',
	[keys.sipgateUsersPlural]: 'Sipgate-Benutzer',

	// SipgateDevices
	[keys.sipgateDevicesSingular]: 'Sipgate-Gerät',
	[keys.sipgateDevicesPlural]: 'Sipgate-Geräte',

	// SipgateChannels
	[keys.sipgateChannelsSingular]: 'Sipgate-Kanal',
	[keys.sipgateChannelsPlural]: 'Sipgate-Kanäle',

	// Fields
	[keys.fieldPhoneNumber]: 'Telefonnummer',

	// Widgets
	[keys.widgetCallActivity]: 'Anrufaktivität',

	// SipgateUsers field descriptions
	[keys.sipgateUsersDescUserId]: 'Sipgate-Benutzer-ID (z. B. w0)',
	[keys.sipgateUsersDescDefaultDevice]: 'Standard-Geräte-ID (z. B. e0)',
	[keys.sipgateUsersDescDefaultChannel]:
		'Persönliche Kanal-UUID (wird automatisch beim Kanal-Sync gesetzt)',
	[keys.sipgateUsersDescBusyOnBusy]:
		'Neue eingehende Anrufe ablehnen, wenn bereits telefoniert wird',
	[keys.sipgateUsersDescPayloadUser]: 'Verknüpfung mit dem entsprechenden Payload-Benutzerkonto',
	[keys.sipgateUsersDescAccessToken]: 'OAuth2-Zugriffstoken (automatisch verwaltet)',
	[keys.sipgateUsersDescRefreshToken]: 'OAuth2-Aktualisierungstoken (automatisch verwaltet)',
	[keys.sipgateUsersDescTokenExpiresAt]: 'Ablaufdatum des aktuellen Zugriffstokens',

	// OAuth-Schaltfläche
	[keys.oauthButtonConnect]: 'Sipgate verbinden',
	[keys.oauthButtonReconnect]: 'Sipgate erneut verbinden',

	// SipgateDevices field labels and descriptions
	[keys.sipgateDevicesLabelDnd]: 'Nicht stören',
	[keys.sipgateDevicesLabelUserDefaults]: 'Benutzerstandards',
	[keys.sipgateDevicesDescDeviceId]: 'Sipgate-Geräte-ID (z. B. e0)',
	[keys.sipgateDevicesDescSipgateUserId]: 'Sipgate-Benutzer-ID (z. B. w0)',
	[keys.sipgateDevicesDescSipgateUser]: 'Sipgate-Benutzer',
	[keys.sipgateDevicesDescActiveGroups]: 'Kanalgruppen, in denen dieses Gerät aktiv ist',
	[keys.sipgateDevicesDescActivePhonelines]: 'Telefonleitungen, auf denen dieses Gerät aktiv ist',

	// SipgateChannels field labels and descriptions
	[keys.sipgateChannelsLabelUserDefaults]: 'Benutzerstandards',
	[keys.sipgateChannelsDescChannelId]: 'Sipgate-Kanal-ID',
	[keys.sipgateChannelsDescOwner]: 'Sipgate-Benutzer-ID des Kanalinhabers (z. B. w0)',
	[keys.sipgateChannelsDescAssignedUsers]:
		'Dem Kanal zugewiesene Benutzer und ihre aktiven Geräte-IDs',
	[keys.sipgateChannelsDescAssignedUsersUser]:
		'Aufgelöster Sipgate-Benutzer (wird beim Sync befüllt)',
	[keys.sipgateChannelsDescAssignedUsersSipgateUserId]:
		'Rohe Sipgate-Benutzer-ID (z. B. w0) zur Auflösung der Verknüpfung beim Sync',

	// IVR Voice Lines
	[keys.ivrVoiceLinesSingular]: 'IVR-Sprachzeile',
	[keys.ivrVoiceLinesPlural]: 'IVR-Sprachzeilen',
	[keys.ivrVoiceLinesFieldTitle]: 'Titel',

	// IVR Flows
	[keys.ivrFlowsSingular]: 'IVR-Ablauf',
	[keys.ivrFlowsPlural]: 'IVR-Abläufe',
	[keys.ivrFlowsFieldName]: 'Name',
	[keys.ivrFlowsFieldPhoneNumber]: 'Telefonnummer',
	[keys.ivrFlowsFieldPhoneNumberDesc]:
		'Die Rufnummer (DID), die diesen Ablauf auslöst. Leer lassen für einen Catch-all-Ablauf.',
	[keys.ivrFlowsFieldIsActive]: 'Aktiv',
	[keys.ivrFlowsFieldEntryStepId]: 'Eingangsschritt-ID',
	[keys.ivrFlowsFieldEntryStepIdDesc]:
		'Die stepId des ersten Schritts, der beim Annehmen des Anrufs ausgeführt wird.',
	[keys.ivrFlowsFieldSteps]: 'Schritte',
	[keys.ivrFlowsFieldStepsStepId]: 'Schritt-ID',
	[keys.ivrFlowsFieldStepsStepIdDesc]:
		'Eindeutige Bezeichnung dieses Schritts innerhalb des Ablaufs.',
	[keys.ivrFlowsFieldStepsType]: 'Typ',
	[keys.ivrFlowsFieldStepsVoiceLine]: 'Sprachzeile',
	[keys.ivrFlowsFieldStepsHangupAfterPlay]: 'Nach Wiedergabe auflegen',
	[keys.ivrFlowsFieldStepsHangupAfterPlayDesc]:
		'Anruf beenden, nachdem die Audiodatei vollständig abgespielt wurde.',
	[keys.ivrFlowsFieldStepsMaxDigits]: 'Max. Ziffern',
	[keys.ivrFlowsFieldStepsMaxDigitsDesc]: 'Maximale Anzahl der zu erfassenden DTMF-Ziffern.',
	[keys.ivrFlowsFieldStepsTimeout]: 'Timeout (ms)',
	[keys.ivrFlowsFieldStepsTimeoutDesc]:
		'Millisekunden, die nach der Ansage auf DTMF-Eingabe gewartet wird.',
	[keys.ivrFlowsFieldStepsBranches]: 'Verzweigungen',
	[keys.ivrFlowsFieldStepsBranchesDesc]: 'DTMF-Eingaben den nächsten Schritten zuordnen.',
	[keys.ivrFlowsFieldStepsBranchesDtmf]: 'DTMF',
	[keys.ivrFlowsFieldStepsBranchesDtmfDesc]:
		'DTMF-Eingabe, die diese Verzweigung auslöst (z. B. "1", "2", "123").',
	[keys.ivrFlowsFieldStepsBranchesNextStepId]: 'Nächste Schritt-ID',
	[keys.ivrFlowsFieldStepsBranchesNextStepIdDesc]:
		'Die stepId, zu der gewechselt wird, wenn diese Verzweigung zutrifft.',
	[keys.ivrFlowsFieldStepsFallbackStepId]: 'Fallback-Schritt-ID',
	[keys.ivrFlowsFieldStepsFallbackStepIdDesc]:
		'Schritt bei keiner passenden Verzweigung. Auflegen, wenn nicht angegeben.',
}
