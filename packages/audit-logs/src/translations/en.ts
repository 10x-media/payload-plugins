import { keys, type TranslationKey } from './keys'

/**
 * English values, keyed by the typed constants in `keys.ts` so the two stay in
 * lockstep. The `Record<TranslationKey, string>` annotation makes a missing or
 * unknown key a type error. `translations/index.ts` nests these for Payload.
 */
export const en: Record<TranslationKey, string> = {
	[keys.pluginName]: 'Audit Logs',
	// View header
	[keys.title]: 'Audit Logs',
	[keys.entries]: '{{count}} entries',

	// Breadcrumb / step nav
	[keys.breadcrumb]: 'Audit logs',

	// Access messages (server-rendered)
	[keys.selectTenant]: 'Select a tenant to view audit logs.',

	// Empty state
	[keys.noEntries]: 'No audit log entries found.',

	// Pagination
	[keys.paginationInfo]: '{{from}}–{{to}} of {{total}}',

	// Debug bar
	[keys.debug]: 'Debug',
	[keys.queuing]: 'Queuing…',
	[keys.runArchive]: 'Run Archive',
	[keys.runDelete]: 'Run Delete',

	// Filter bar
	[keys.filterCollection]: 'Collection',
	[keys.filterGlobal]: 'Global',
	[keys.filterOperation]: 'Operation',
	[keys.filterTenant]: 'Tenant',
	[keys.filterUser]: 'User',
	[keys.filterDocument]: 'Document',
	[keys.filterEventType]: 'Event type',
	[keys.filterChangedPath]: 'Changed path',
	[keys.filterGroup]: 'Group',
	[keys.groupFilterBtn]: 'Filter by group',
	[keys.filterDate]: 'Date',
	[keys.filterDateRange]: 'Date range',
	[keys.addFilter]: '+ Add filter',
	[keys.apply]: 'Apply',
	[keys.clearAll]: 'Clear all',

	// Editors shared
	[keys.selectPlaceholder]: '— Select —',
	[keys.done]: 'Done',

	// Date range editor
	[keys.dateFrom]: 'From',
	[keys.dateTo]: 'To',
	[keys.startDate]: 'Start date…',
	[keys.endDate]: 'End date…',

	// Single value editor
	[keys.groupPlaceholder]: 'Group ID…',
	[keys.orEnterId]: 'or enter ID manually',
	[keys.selectCollectionHint]: 'Select a collection filter to enable search',
	[keys.documentIdPlaceholder]: 'Document ID…',
	[keys.update]: 'Update',
	[keys.add]: 'Add',
	[keys.selectEventPlaceholder]: '— Select event —',
	[keys.eventTypePlaceholder]: 'Event type…',
	[keys.fieldPathPlaceholder]: 'Field path…',

	// User filter editor
	[keys.selectCollectionPlaceholder]: 'Select collection…',
	[keys.userIdPlaceholder]: 'User ID…',

	// Doc select
	[keys.searchPlaceholder]: 'Search…',

	// Log row
	[keys.metaIp]: 'IP',
	[keys.metaUa]: 'UA',
	[keys.metaLocale]: 'Locale',
	[keys.filterEvent]: 'Event',
	[keys.filterAll]: 'All',
	[keys.dateAnyTime]: 'Any time',
	[keys.dateLast24h]: 'Last 24 hours',
	[keys.dateLast7d]: 'Last 7 days',
	[keys.dateLast30d]: 'Last 30 days',
	[keys.dateCustomRange]: 'Custom range…',
	[keys.eventGroupWrites]: 'Changes',
	[keys.eventGroupAuth]: 'Auth',
	[keys.eventGroupCustom]: 'Custom',
	[keys.eventAllAuth]: 'All auth events',
	[keys.eventAllCustom]: 'All custom events',
	[keys.eventOther]: 'Other event type…',
	[keys.moreFilters]: 'More filters',
	[keys.choose]: 'Choose…',
	[keys.refPlaceholder]: 'Choose, or type an ID',
	[keys.impersonated]: 'impersonated',
	[keys.impersonatedBy]: 'Impersonated by',
	[keys.deletedUser]: 'Deleted user',
	[keys.toggleDetails]: 'Toggle details',
	[keys.sectionSnapshot]: 'Snapshot',
	[keys.sectionAuthEvent]: 'Auth event',
	[keys.sectionCustomEvent]: 'Custom event',
	[keys.viewGlobal]: 'Global',
	[keys.viewDocument]: 'Document',
	[keys.fieldsChanged]: '{{count}} field',
	[keys.fieldsChangedPlural]: '{{count}} fields',

	// Diff viewer
	[keys.diffPath]: 'Path',
	[keys.diffBefore]: 'Before',
	[keys.diffAfter]: 'After',
	[keys.diffValue]: 'Value',
	[keys.rawJson]: 'Raw JSON',

	// Auth events
	[keys.authEventLogin]: 'Login',
	[keys.authEventForgotPassword]: 'Forgot password',
	[keys.authEventFailedLogin]: 'Failed login',
}
