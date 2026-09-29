import { keys, type TranslationKey } from './keys'

/** French values, keyed by the typed constants in `keys.ts` (see `en.ts`). */
export const fr: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Verrouillage du contenu',
	[keys.collectionSingular]: 'Verrouillage du contenu',
	[keys.collectionPlural]: 'Verrouillages du contenu',

	[keys.fieldTitle]: 'Titre',
	[keys.fieldAnnounceAt]: 'Annoncer à partir du',
	[keys.fieldAnnounceAtDescription]:
		'Moment où la bannière programmée commence à s’afficher. Laissez vide pour ne rien annoncer.',
	[keys.fieldStartsAt]: 'Commence le',
	[keys.fieldStartsAtDescription]: 'Laissez vide pour verrouiller le contenu immédiatement.',
	[keys.fieldEndAtTime]: 'Terminer à une heure définie',
	[keys.fieldEndsAt]: 'Se termine le',
	[keys.fieldEndedAt]: 'Terminé le',
	[keys.fieldLockEverything]: 'Tout verrouiller',
	[keys.fieldLockEverythingDescription]:
		'Désactivez pour verrouiller uniquement le contenu sélectionné.',
	[keys.fieldGroups]: 'Groupes',
	[keys.fieldCollections]: 'Collections',
	[keys.fieldGlobals]: 'Globals',
	[keys.fieldMessage]: 'Message',
	[keys.fieldAnnouncementMessageDescription]:
		'Affiché tant que le verrouillage est annoncé. Laisser vide pour l’avis par défaut.',
	[keys.fieldActiveMessageDescription]:
		'Affiché tant que le verrouillage est actif. Laisser vide pour l’avis par défaut.',
	[keys.tabAnnouncement]: 'Annonce',
	[keys.tabActive]: 'Pendant le verrouillage',
	[keys.fieldStatus]: 'Statut',
	[keys.statusDraft]: 'Brouillon',
	[keys.statusPending]: 'En attente',
	[keys.statusAnnounced]: 'Annoncé',
	[keys.statusActive]: 'Actif',
	[keys.statusEnded]: 'Terminé',

	[keys.dateBlockLabel]: 'Date',
	[keys.dateBlockDate]: 'Date et heure',
	[keys.dateBlockFormat]: 'Format',
	[keys.dateBlockSource]: 'Date issue de',
	[keys.sourceStartsAt]: 'Début du verrouillage',
	[keys.sourceEndsAt]: 'Fin du verrouillage',
	[keys.sourceAnnounceAt]: 'Début de l’annonce',
	[keys.sourceCustom]: 'Date personnalisée',
	[keys.scopeBlockLabel]: 'Contenu verrouillé',
	[keys.scopeEverything]: 'tout le contenu',
	[keys.dateOpenEnd]: 'nouvel ordre',
	[keys.formatDatetime]: 'Date et heure',
	[keys.formatDate]: 'Date',
	[keys.formatTime]: 'Heure',
	[keys.formatRelative]: 'Relatif',

	[keys.errorAnnounceAfterStart]: 'L’annonce doit commencer avant le verrouillage.',
	[keys.errorEndBeforeStart]: 'Le verrouillage doit se terminer après son début.',
	[keys.errorEndsAtRequired]: 'Indiquez quand le verrouillage se termine.',
	[keys.errorTargetsRequired]: 'Choisissez au moins un élément à verrouiller.',
	[keys.errorEndedReadOnly]: 'Un verrouillage terminé ne peut plus être modifié.',
	[keys.errorActiveStartMoved]:
		'Un verrouillage actif ne peut pas être reporté dans le futur. Terminez-le et programmez-en un nouveau.',
	[keys.errorLocked]: 'Le contenu est verrouillé pour maintenance. Veuillez réessayer plus tard.',

	[keys.bannerAnnouncedTitle]: 'Maintenance prévue',
	[keys.bannerActiveTitle]: 'Maintenance en cours',
	[keys.bannerAnnouncedEverything]: 'Le contenu sera en lecture seule.',
	[keys.bannerActiveEverything]: 'Le contenu est en lecture seule.',
	[keys.bannerAnnouncedPartial]: 'Passera en lecture seule : {{what}}.',
	[keys.bannerActivePartial]: 'En lecture seule : {{what}}.',
	[keys.bannerFrom]: 'Du',
	[keys.bannerUntil]: 'Jusqu’au',
	[keys.bannerEndsIn]: 'Se termine dans {{time}}',
	[keys.bannerDismiss]: 'Masquer',
	[keys.bannerPrevious]: 'Avis précédent',
	[keys.bannerNext]: 'Avis suivant',
	[keys.bannerPosition]: 'Avis {{current}} sur {{total}}',

	[keys.actionLockNow]: 'Verrouiller maintenant',
	[keys.actionLockNowTitle]: 'Verrouillage imprévu',
	[keys.actionEndNow]: 'Terminer maintenant',
	[keys.actionFailed]: 'Impossible de mettre à jour le verrouillage.',
	[keys.confirmLockNowHeading]: 'Verrouiller tout le contenu maintenant ?',
	[keys.confirmLockNowBody]:
		'Tout le monde perd immédiatement l’accès en écriture, jusqu’à ce que quelqu’un termine ce verrouillage.',
	[keys.confirmEndNowHeading]: 'Terminer ce verrouillage maintenant ?',
	[keys.confirmEndNowBody]:
		'Le contenu concerné par ce verrouillage redevient modifiable immédiatement.',
}
