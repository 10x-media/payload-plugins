/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`), or it is a type error.
 */
export const keys = {
	pluginName: 'sipgate:pluginName',

	// CallLogs collection
	callLogsSingular: 'sipgate:callLogs.singular',
	callLogsPlural: 'sipgate:callLogs.plural',

	// SipgateUsers collection
	sipgateUsersSingular: 'sipgate:sipgateUsers.singular',
	sipgateUsersPlural: 'sipgate:sipgateUsers.plural',

	// SipgateDevices collection
	sipgateDevicesSingular: 'sipgate:sipgateDevices.singular',
	sipgateDevicesPlural: 'sipgate:sipgateDevices.plural',

	// SipgateChannels collection
	sipgateChannelsSingular: 'sipgate:sipgateChannels.singular',
	sipgateChannelsPlural: 'sipgate:sipgateChannels.plural',

	// Fields
	fieldPhoneNumber: 'sipgate:field.phoneNumber',

	// Widgets
	widgetCallActivity: 'sipgate:widget.callActivity',

	// SipgateUsers field descriptions
	sipgateUsersDescUserId: 'sipgate:sipgateUsers.desc.userId',
	sipgateUsersDescDefaultDevice: 'sipgate:sipgateUsers.desc.defaultDevice',
	sipgateUsersDescDefaultChannel: 'sipgate:sipgateUsers.desc.defaultChannel',
	sipgateUsersDescBusyOnBusy: 'sipgate:sipgateUsers.desc.busyOnBusy',
	sipgateUsersDescPayloadUser: 'sipgate:sipgateUsers.desc.payloadUser',

	// SipgateDevices field labels and descriptions
	sipgateDevicesLabelDnd: 'sipgate:sipgateDevices.label.dnd',
	sipgateDevicesLabelUserDefaults: 'sipgate:sipgateDevices.label.userDefaults',
	sipgateDevicesDescDeviceId: 'sipgate:sipgateDevices.desc.deviceId',
	sipgateDevicesDescSipgateUserId: 'sipgate:sipgateDevices.desc.sipgateUserId',
	sipgateDevicesDescSipgateUser: 'sipgate:sipgateDevices.desc.sipgateUser',
	sipgateDevicesDescActiveGroups: 'sipgate:sipgateDevices.desc.activeGroups',
	sipgateDevicesDescActivePhonelines: 'sipgate:sipgateDevices.desc.activePhonelines',

	// SipgateChannels field labels and descriptions
	sipgateChannelsLabelUserDefaults: 'sipgate:sipgateChannels.label.userDefaults',
	sipgateChannelsDescChannelId: 'sipgate:sipgateChannels.desc.channelId',
	sipgateChannelsDescOwner: 'sipgate:sipgateChannels.desc.owner',
	sipgateChannelsDescAssignedUsers: 'sipgate:sipgateChannels.desc.assignedUsers',
	sipgateChannelsDescAssignedUsersUser: 'sipgate:sipgateChannels.desc.assignedUsers.user',
	sipgateChannelsDescAssignedUsersSipgateUserId:
		'sipgate:sipgateChannels.desc.assignedUsers.sipgateUserId',

	// SipgateUsers OAuth token field descriptions
	sipgateUsersDescAccessToken: 'sipgate:sipgateUsers.desc.accessToken',
	sipgateUsersDescRefreshToken: 'sipgate:sipgateUsers.desc.refreshToken',
	sipgateUsersDescTokenExpiresAt: 'sipgate:sipgateUsers.desc.tokenExpiresAt',

	// OAuth button
	oauthButtonConnect: 'sipgate:oauth.button.connect',
	oauthButtonReconnect: 'sipgate:oauth.button.reconnect',
	oauthTokenExpired: 'sipgate:oauth.token.expired',

	// IVR Voice Lines collection
	ivrVoiceLinesSingular: 'sipgate:ivrVoiceLines.singular',
	ivrVoiceLinesPlural: 'sipgate:ivrVoiceLines.plural',
	ivrVoiceLinesFieldTitle: 'sipgate:ivrVoiceLines.field.title',

	// IVR Flows collection
	ivrFlowsSingular: 'sipgate:ivrFlows.singular',
	ivrFlowsPlural: 'sipgate:ivrFlows.plural',
	ivrFlowsFieldName: 'sipgate:ivrFlows.field.name',
	ivrFlowsFieldPhoneNumber: 'sipgate:ivrFlows.field.phoneNumber',
	ivrFlowsFieldPhoneNumberDesc: 'sipgate:ivrFlows.field.phoneNumber.description',
	ivrFlowsFieldIsActive: 'sipgate:ivrFlows.field.isActive',
	ivrFlowsFieldEntryStepId: 'sipgate:ivrFlows.field.entryStepId',
	ivrFlowsFieldEntryStepIdDesc: 'sipgate:ivrFlows.field.entryStepId.description',
	ivrFlowsFieldSteps: 'sipgate:ivrFlows.field.steps',
	ivrFlowsFieldStepsStepId: 'sipgate:ivrFlows.field.steps.stepId',
	ivrFlowsFieldStepsStepIdDesc: 'sipgate:ivrFlows.field.steps.stepId.description',
	ivrFlowsFieldStepsType: 'sipgate:ivrFlows.field.steps.type',
	ivrFlowsFieldStepsVoiceLine: 'sipgate:ivrFlows.field.steps.voiceLine',
	ivrFlowsFieldStepsHangupAfterPlay: 'sipgate:ivrFlows.field.steps.hangupAfterPlay',
	ivrFlowsFieldStepsHangupAfterPlayDesc: 'sipgate:ivrFlows.field.steps.hangupAfterPlay.description',
	ivrFlowsFieldStepsMaxDigits: 'sipgate:ivrFlows.field.steps.maxDigits',
	ivrFlowsFieldStepsMaxDigitsDesc: 'sipgate:ivrFlows.field.steps.maxDigits.description',
	ivrFlowsFieldStepsTimeout: 'sipgate:ivrFlows.field.steps.timeout',
	ivrFlowsFieldStepsTimeoutDesc: 'sipgate:ivrFlows.field.steps.timeout.description',
	ivrFlowsFieldStepsBranches: 'sipgate:ivrFlows.field.steps.branches',
	ivrFlowsFieldStepsBranchesDesc: 'sipgate:ivrFlows.field.steps.branches.description',
	ivrFlowsFieldStepsBranchesDtmf: 'sipgate:ivrFlows.field.steps.branches.dtmf',
	ivrFlowsFieldStepsBranchesDtmfDesc: 'sipgate:ivrFlows.field.steps.branches.dtmf.description',
	ivrFlowsFieldStepsBranchesNextStepId: 'sipgate:ivrFlows.field.steps.branches.nextStepId',
	ivrFlowsFieldStepsBranchesNextStepIdDesc:
		'sipgate:ivrFlows.field.steps.branches.nextStepId.description',
	ivrFlowsFieldStepsFallbackStepId: 'sipgate:ivrFlows.field.steps.fallbackStepId',
	ivrFlowsFieldStepsFallbackStepIdDesc: 'sipgate:ivrFlows.field.steps.fallbackStepId.description',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
