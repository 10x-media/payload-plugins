import { keys, type TranslationKey } from './keys'

export const fr: Record<TranslationKey, string> = {
	[keys.pluginName]: "Journaux d'audit",
	// View header
	[keys.title]: "Journaux d'audit",
	[keys.entries]: '{{count}} entrées',

	// Breadcrumb / step nav
	[keys.breadcrumb]: "Journaux d'audit",

	// Access messages (server-rendered)
	[keys.selectTenant]: "Sélectionnez un locataire pour consulter les journaux d'audit.",

	// Empty state
	[keys.noEntries]: "Aucune entrée d'audit trouvée.",

	// Pagination
	[keys.paginationInfo]: '{{from}}–{{to}} sur {{total}}',

	// Debug bar
	[keys.debug]: 'Débogage',
	[keys.queuing]: "Mise en file d'attente…",
	[keys.runArchive]: "Lancer l'archivage",
	[keys.runDelete]: 'Lancer la suppression',

	// Filter bar
	[keys.filterCollection]: 'Collection',
	[keys.filterGlobal]: 'Global',
	[keys.filterOperation]: 'Opération',
	[keys.filterTenant]: 'Locataire',
	[keys.filterUser]: 'Utilisateur',
	[keys.filterDocument]: 'Document',
	[keys.filterEventType]: "Type d'événement",
	[keys.filterChangedPath]: 'Chemin modifié',
	[keys.filterGroup]: 'Groupe',
	[keys.groupFilterBtn]: 'Filtrer par groupe',
	[keys.filterDate]: 'Date',
	[keys.filterDateRange]: 'Plage de dates',
	[keys.addFilter]: '+ Ajouter un filtre',
	[keys.apply]: 'Appliquer',
	[keys.clearAll]: 'Tout effacer',

	// Editors shared
	[keys.selectPlaceholder]: '— Sélectionner —',
	[keys.done]: 'Terminé',

	// Date range editor
	[keys.dateFrom]: 'Du',
	[keys.dateTo]: 'Au',
	[keys.startDate]: 'Date de début…',
	[keys.endDate]: 'Date de fin…',

	// Single value editor
	[keys.groupPlaceholder]: 'ID du groupe…',
	[keys.orEnterId]: "ou saisissez l'ID manuellement",
	[keys.selectCollectionHint]: 'Sélectionnez un filtre de collection pour activer la recherche',
	[keys.documentIdPlaceholder]: 'ID du document…',
	[keys.update]: 'Mettre à jour',
	[keys.add]: 'Ajouter',
	[keys.selectEventPlaceholder]: '— Sélectionner un événement —',
	[keys.eventTypePlaceholder]: "Type d'événement…",
	[keys.fieldPathPlaceholder]: 'Chemin du champ…',

	// User filter editor
	[keys.selectCollectionPlaceholder]: 'Sélectionner une collection…',
	[keys.userIdPlaceholder]: "ID de l'utilisateur…",

	// Doc select
	[keys.searchPlaceholder]: 'Rechercher…',

	// Log row
	[keys.metaIp]: 'IP',
	[keys.metaUa]: 'UA',
	[keys.metaLocale]: 'Langue',
	[keys.sectionSnapshot]: 'Instantané',
	[keys.sectionAuthEvent]: "Événement d'authentification",
	[keys.sectionCustomEvent]: 'Événement personnalisé',
	[keys.viewGlobal]: 'Voir le global →',
	[keys.viewDocument]: 'Voir le document →',
	[keys.fieldsChanged]: '{{count}} champ',
	[keys.fieldsChangedPlural]: '{{count}} champs',

	// Diff viewer
	[keys.diffPath]: 'Chemin',
	[keys.diffBefore]: 'Avant',
	[keys.diffAfter]: 'Après',

	// Auth events
	[keys.authEventLogin]: 'Connexion',
	[keys.authEventForgotPassword]: 'Mot de passe oublié',
	[keys.authEventFailedLogin]: 'Échec de connexion',
}
