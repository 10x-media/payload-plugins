import { keys, type TranslationKey } from './keys'

/** German values, keyed by the typed constants in `keys.ts` (see `en.ts`). */
export const de: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Inhaltssperre',
	[keys.collectionSingular]: 'Inhaltssperre',
	[keys.collectionPlural]: 'Inhaltssperren',

	[keys.fieldTitle]: 'Titel',
	[keys.fieldAnnounceAt]: 'Ankündigen ab',
	[keys.fieldAnnounceAtDescription]:
		'Ab wann das Banner angezeigt wird. Leer lassen, um nichts anzukündigen.',
	[keys.fieldStartsAt]: 'Beginnt am',
	[keys.fieldStartsAtDescription]: 'Leer lassen, um Inhalte sofort zu sperren.',
	[keys.fieldEndAtTime]: 'Zu einem festen Zeitpunkt beenden',
	[keys.fieldEndsAt]: 'Endet am',
	[keys.fieldEndedAt]: 'Beendet am',
	[keys.fieldLockEverything]: 'Alles sperren',
	[keys.fieldLockEverythingDescription]: 'Deaktivieren, um nur ausgewählte Inhalte zu sperren.',
	[keys.fieldGroups]: 'Gruppen',
	[keys.fieldCollections]: 'Sammlungen',
	[keys.fieldGlobals]: 'Globale Dokumente',
	[keys.fieldMessage]: 'Nachricht',
	[keys.fieldMessageDescription]: 'Optionaler Text im Banner unter dem Standardhinweis.',
	[keys.fieldStatus]: 'Status',
	[keys.statusPending]: 'Ausstehend',
	[keys.statusAnnounced]: 'Angekündigt',
	[keys.statusActive]: 'Aktiv',
	[keys.statusEnded]: 'Beendet',

	[keys.dateBlockLabel]: 'Datum',
	[keys.dateBlockDate]: 'Datum und Uhrzeit',
	[keys.dateBlockFormat]: 'Format',
	[keys.formatDatetime]: 'Datum und Uhrzeit',
	[keys.formatDate]: 'Datum',
	[keys.formatTime]: 'Uhrzeit',
	[keys.formatRelative]: 'Relativ',

	[keys.errorAnnounceAfterStart]: 'Die Ankündigung muss vor der Sperre beginnen.',
	[keys.errorEndBeforeStart]: 'Die Sperre muss nach ihrem Beginn enden.',
	[keys.errorEndsAtRequired]: 'Lege fest, wann die Sperre endet.',
	[keys.errorTargetsRequired]: 'Wähle mindestens ein Element zum Sperren aus.',
	[keys.errorEndedReadOnly]: 'Eine beendete Sperre kann nicht mehr geändert werden.',
	[keys.errorActiveStartMoved]:
		'Eine aktive Sperre kann nicht in die Zukunft verschoben werden. Beende sie und plane eine neue.',
	[keys.errorLocked]:
		'Inhalte sind wegen Wartungsarbeiten gesperrt. Bitte versuche es später erneut.',

	[keys.bannerAnnouncedTitle]: 'Geplante Wartung',
	[keys.bannerActiveTitle]: 'Wartung läuft',
	[keys.bannerAnnouncedEverything]: 'Inhalte werden schreibgeschützt sein.',
	[keys.bannerActiveEverything]: 'Inhalte sind schreibgeschützt.',
	[keys.bannerAnnouncedPartial]: 'Wird schreibgeschützt: {{what}}.',
	[keys.bannerActivePartial]: 'Schreibgeschützt: {{what}}.',
	[keys.bannerFrom]: 'Von',
	[keys.bannerUntil]: 'Bis',
	[keys.bannerEndsIn]: 'Endet in {{time}}',
	[keys.bannerDismiss]: 'Ausblenden',

	[keys.actionLockNow]: 'Jetzt sperren',
	[keys.actionLockNowTitle]: 'Ungeplante Sperre',
	[keys.actionEndNow]: 'Jetzt beenden',
	[keys.actionFailed]: 'Die Sperre konnte nicht aktualisiert werden.',
	[keys.confirmLockNowHeading]: 'Alle Inhalte jetzt sperren?',
	[keys.confirmLockNowBody]:
		'Alle verlieren sofort den Schreibzugriff, bis jemand diese Sperre beendet.',
	[keys.confirmEndNowHeading]: 'Diese Sperre jetzt beenden?',
	[keys.confirmEndNowBody]: 'Von dieser Sperre betroffene Inhalte sind sofort wieder bearbeitbar.',
}
