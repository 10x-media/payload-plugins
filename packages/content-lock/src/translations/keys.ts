/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale, or it is a type error.
 */
export const keys = {
	pluginName: 'contentLock:pluginName',
	collectionSingular: 'contentLock:collectionSingular',
	collectionPlural: 'contentLock:collectionPlural',

	fieldTitle: 'contentLock:fieldTitle',
	fieldAnnounceAt: 'contentLock:fieldAnnounceAt',
	fieldAnnounceAtDescription: 'contentLock:fieldAnnounceAtDescription',
	fieldStartsAt: 'contentLock:fieldStartsAt',
	fieldStartsAtDescription: 'contentLock:fieldStartsAtDescription',
	fieldEndAtTime: 'contentLock:fieldEndAtTime',
	fieldEndsAt: 'contentLock:fieldEndsAt',
	fieldEndedAt: 'contentLock:fieldEndedAt',
	fieldLockEverything: 'contentLock:fieldLockEverything',
	fieldLockEverythingDescription: 'contentLock:fieldLockEverythingDescription',
	fieldGroups: 'contentLock:fieldGroups',
	fieldCollections: 'contentLock:fieldCollections',
	fieldGlobals: 'contentLock:fieldGlobals',
	fieldMessage: 'contentLock:fieldMessage',
	fieldMessageDescription: 'contentLock:fieldMessageDescription',
	fieldStatus: 'contentLock:fieldStatus',
	statusPending: 'contentLock:statusPending',
	statusAnnounced: 'contentLock:statusAnnounced',
	statusActive: 'contentLock:statusActive',
	statusEnded: 'contentLock:statusEnded',

	dateBlockLabel: 'contentLock:dateBlockLabel',
	dateBlockDate: 'contentLock:dateBlockDate',
	dateBlockFormat: 'contentLock:dateBlockFormat',
	formatDatetime: 'contentLock:formatDatetime',
	formatDate: 'contentLock:formatDate',
	formatTime: 'contentLock:formatTime',
	formatRelative: 'contentLock:formatRelative',

	errorAnnounceAfterStart: 'contentLock:errorAnnounceAfterStart',
	errorEndBeforeStart: 'contentLock:errorEndBeforeStart',
	errorEndsAtRequired: 'contentLock:errorEndsAtRequired',
	errorTargetsRequired: 'contentLock:errorTargetsRequired',
	errorEndedReadOnly: 'contentLock:errorEndedReadOnly',
	errorActiveStartMoved: 'contentLock:errorActiveStartMoved',
	errorLocked: 'contentLock:errorLocked',

	bannerAnnouncedTitle: 'contentLock:bannerAnnouncedTitle',
	bannerActiveTitle: 'contentLock:bannerActiveTitle',
	bannerAnnouncedEverything: 'contentLock:bannerAnnouncedEverything',
	bannerActiveEverything: 'contentLock:bannerActiveEverything',
	bannerAnnouncedPartial: 'contentLock:bannerAnnouncedPartial',
	bannerActivePartial: 'contentLock:bannerActivePartial',
	bannerFrom: 'contentLock:bannerFrom',
	bannerUntil: 'contentLock:bannerUntil',
	bannerEndsIn: 'contentLock:bannerEndsIn',
	bannerDismiss: 'contentLock:bannerDismiss',

	actionLockNow: 'contentLock:actionLockNow',
	actionLockNowTitle: 'contentLock:actionLockNowTitle',
	actionEndNow: 'contentLock:actionEndNow',
	actionFailed: 'contentLock:actionFailed',
	confirmLockNowHeading: 'contentLock:confirmLockNowHeading',
	confirmLockNowBody: 'contentLock:confirmLockNowBody',
	confirmEndNowHeading: 'contentLock:confirmEndNowHeading',
	confirmEndNowBody: 'contentLock:confirmEndNowBody',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
