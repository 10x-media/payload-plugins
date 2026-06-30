import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Sipgate',

	// CallLogs
	[keys.callLogsSingular]: 'Call Log',
	[keys.callLogsPlural]: 'Call Logs',

	// SipgateUsers
	[keys.sipgateUsersSingular]: 'Sipgate User',
	[keys.sipgateUsersPlural]: 'Sipgate Users',

	// SipgateDevices
	[keys.sipgateDevicesSingular]: 'Sipgate Device',
	[keys.sipgateDevicesPlural]: 'Sipgate Devices',

	// SipgateChannels
	[keys.sipgateChannelsSingular]: 'Sipgate Channel',
	[keys.sipgateChannelsPlural]: 'Sipgate Channels',

	// Fields
	[keys.fieldPhoneNumber]: 'Phone Number',

	// Widgets
	[keys.widgetCallActivity]: 'Call Activity',

	// SipgateUsers field descriptions
	[keys.sipgateUsersDescUserId]: 'Sipgate user ID (e.g. w0)',
	[keys.sipgateUsersDescDefaultDevice]: 'Default device ID (e.g. e0)',
	[keys.sipgateUsersDescDefaultChannel]:
		'Personal channel UUID (set automatically by channel sync)',
	[keys.sipgateUsersDescBusyOnBusy]: 'Reject new incoming calls when already on a call',
	[keys.sipgateUsersDescPayloadUser]: 'Link to the corresponding Payload user account',

	// SipgateDevices field labels and descriptions
	[keys.sipgateDevicesLabelDnd]: 'Do Not Disturb',
	[keys.sipgateDevicesLabelUserDefaults]: 'User Defaults',
	[keys.sipgateDevicesDescDeviceId]: 'Sipgate device ID (e.g. e0)',
	[keys.sipgateDevicesDescSipgateUserId]: 'Sipgate user ID (e.g. w0)',
	[keys.sipgateDevicesDescSipgateUser]: 'Sipgate user',
	[keys.sipgateDevicesDescActiveGroups]: 'Channel groups this device is currently active in',
	[keys.sipgateDevicesDescActivePhonelines]: 'Phonelines this device is currently active on',

	// SipgateChannels field labels and descriptions
	[keys.sipgateChannelsLabelUserDefaults]: 'User Defaults',
	[keys.sipgateChannelsDescChannelId]: 'Sipgate channel ID',
	[keys.sipgateChannelsDescOwner]: 'Sipgate user ID of the channel owner (e.g. w0)',
	[keys.sipgateChannelsDescAssignedUsers]:
		'Users assigned to this channel and their active device IDs',
	[keys.sipgateChannelsDescAssignedUsersUser]: 'Resolved sipgate user (populated on sync)',
	[keys.sipgateChannelsDescAssignedUsersSipgateUserId]:
		'Raw sipgate user ID (e.g. w0) — used to resolve the relationship on sync',

	// IVR Voice Lines
	[keys.ivrVoiceLinesSingular]: 'IVR Voice Line',
	[keys.ivrVoiceLinesPlural]: 'IVR Voice Lines',
	[keys.ivrVoiceLinesFieldTitle]: 'Title',

	// IVR Flows
	[keys.ivrFlowsSingular]: 'IVR Flow',
	[keys.ivrFlowsPlural]: 'IVR Flows',
	[keys.ivrFlowsFieldName]: 'Name',
	[keys.ivrFlowsFieldPhoneNumber]: 'Phone Number',
	[keys.ivrFlowsFieldPhoneNumberDesc]:
		'The DID that triggers this flow. Leave blank to use as a catch-all.',
	[keys.ivrFlowsFieldIsActive]: 'Active',
	[keys.ivrFlowsFieldEntryStepId]: 'Entry Step ID',
	[keys.ivrFlowsFieldEntryStepIdDesc]:
		'The stepId of the first step to execute when the call is answered.',
	[keys.ivrFlowsFieldSteps]: 'Steps',
	[keys.ivrFlowsFieldStepsStepId]: 'Step ID',
	[keys.ivrFlowsFieldStepsStepIdDesc]: 'Unique identifier for this step within the flow.',
	[keys.ivrFlowsFieldStepsType]: 'Type',
	[keys.ivrFlowsFieldStepsVoiceLine]: 'Voice Line',
	[keys.ivrFlowsFieldStepsHangupAfterPlay]: 'Hang Up After Play',
	[keys.ivrFlowsFieldStepsHangupAfterPlayDesc]:
		'Hang up the call after the audio finishes playing.',
	[keys.ivrFlowsFieldStepsMaxDigits]: 'Max Digits',
	[keys.ivrFlowsFieldStepsMaxDigitsDesc]: 'Maximum number of DTMF digits to collect.',
	[keys.ivrFlowsFieldStepsTimeout]: 'Timeout (ms)',
	[keys.ivrFlowsFieldStepsTimeoutDesc]:
		'Milliseconds to wait for DTMF input after the announcement.',
	[keys.ivrFlowsFieldStepsBranches]: 'Branches',
	[keys.ivrFlowsFieldStepsBranchesDesc]: 'Map DTMF input values to the next step.',
	[keys.ivrFlowsFieldStepsBranchesDtmf]: 'DTMF',
	[keys.ivrFlowsFieldStepsBranchesDtmfDesc]:
		'DTMF input that triggers this branch (e.g. "1", "2", "123").',
	[keys.ivrFlowsFieldStepsBranchesNextStepId]: 'Next Step ID',
	[keys.ivrFlowsFieldStepsBranchesNextStepIdDesc]:
		'The stepId to advance to when this branch is matched.',
	[keys.ivrFlowsFieldStepsFallbackStepId]: 'Fallback Step ID',
	[keys.ivrFlowsFieldStepsFallbackStepIdDesc]:
		'Step to use when no branch matches the input. Hangs up if omitted.',
}
