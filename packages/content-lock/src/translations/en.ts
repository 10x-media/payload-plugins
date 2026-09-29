import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Content Lock',
	[keys.collectionSingular]: 'Content lock',
	[keys.collectionPlural]: 'Content locks',

	[keys.fieldTitle]: 'Title',
	[keys.fieldAnnounceAt]: 'Announce from',
	[keys.fieldAnnounceAtDescription]:
		'When the scheduled banner starts showing. Leave empty for no announcement.',
	[keys.fieldStartsAt]: 'Starts at',
	[keys.fieldStartsAtDescription]: 'Leave empty to lock content immediately.',
	[keys.fieldEndAtTime]: 'End at a set time',
	[keys.fieldEndsAt]: 'Ends at',
	[keys.fieldEndedAt]: 'Ended at',
	[keys.fieldLockEverything]: 'Lock everything',
	[keys.fieldLockEverythingDescription]: 'Turn off to lock only selected content.',
	[keys.fieldGroups]: 'Groups',
	[keys.fieldCollections]: 'Collections',
	[keys.fieldGlobals]: 'Globals',
	[keys.fieldMessage]: 'Message',
	[keys.fieldMessageDescription]: 'Optional text shown in the banner under the default notice.',
	[keys.fieldStatus]: 'Status',
	[keys.statusPending]: 'Pending',
	[keys.statusAnnounced]: 'Announced',
	[keys.statusActive]: 'Active',
	[keys.statusEnded]: 'Ended',

	[keys.dateBlockLabel]: 'Date',
	[keys.dateBlockDate]: 'Date and time',
	[keys.dateBlockFormat]: 'Format',
	[keys.formatDatetime]: 'Date and time',
	[keys.formatDate]: 'Date',
	[keys.formatTime]: 'Time',
	[keys.formatRelative]: 'Relative',

	[keys.errorAnnounceAfterStart]: 'The announcement must start before the lock does.',
	[keys.errorEndBeforeStart]: 'The lock must end after it starts.',
	[keys.errorEndsAtRequired]: 'Set when the lock ends.',
	[keys.errorTargetsRequired]: 'Pick at least one item to lock.',
	[keys.errorEndedReadOnly]: 'An ended lock can no longer be changed.',
	[keys.errorActiveStartMoved]:
		'An active lock cannot be moved to the future. End it and schedule a new one.',
	[keys.errorLocked]: 'Content is locked for maintenance. Please try again later.',

	[keys.bannerAnnouncedTitle]: 'Planned maintenance',
	[keys.bannerActiveTitle]: 'Maintenance in progress',
	[keys.bannerAnnouncedEverything]: 'Content will be read-only.',
	[keys.bannerActiveEverything]: 'Content is read-only.',
	[keys.bannerAnnouncedPartial]: 'Will be read-only: {{what}}.',
	[keys.bannerActivePartial]: 'Read-only: {{what}}.',
	[keys.bannerFrom]: 'From',
	[keys.bannerUntil]: 'Until',
	[keys.bannerEndsIn]: 'Ends in {{time}}',
	[keys.bannerDismiss]: 'Dismiss',

	[keys.actionLockNow]: 'Lock now',
	[keys.actionLockNowTitle]: 'Unplanned lock',
	[keys.actionEndNow]: 'End now',
	[keys.actionFailed]: 'Could not update the lock.',
	[keys.confirmLockNowHeading]: 'Lock all content now?',
	[keys.confirmLockNowBody]:
		'Everyone loses write access immediately, until someone ends this lock.',
	[keys.confirmEndNowHeading]: 'End this lock now?',
	[keys.confirmEndNowBody]: 'Content covered by this lock becomes editable again right away.',
}
