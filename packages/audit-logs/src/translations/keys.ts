/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`), or it is a type error.
 */
export const keys = {
	pluginName: 'auditLogs:pluginName',
	title: 'auditLogs:title',
	entries: 'auditLogs:entries',
	breadcrumb: 'auditLogs:breadcrumb',

	selectTenant: 'auditLogs:selectTenant',

	noEntries: 'auditLogs:noEntries',

	paginationInfo: 'auditLogs:paginationInfo',

	debug: 'auditLogs:debug',
	queuing: 'auditLogs:queuing',
	runArchive: 'auditLogs:runArchive',
	runDelete: 'auditLogs:runDelete',

	filterCollection: 'auditLogs:filterCollection',
	filterGlobal: 'auditLogs:filterGlobal',
	filterOperation: 'auditLogs:filterOperation',
	filterTenant: 'auditLogs:filterTenant',
	filterUser: 'auditLogs:filterUser',
	filterDocument: 'auditLogs:filterDocument',
	filterEventType: 'auditLogs:filterEventType',
	filterChangedPath: 'auditLogs:filterChangedPath',
	filterGroup: 'auditLogs:filterGroup',
	groupFilterBtn: 'auditLogs:groupFilterBtn',
	filterDate: 'auditLogs:filterDate',
	filterDateRange: 'auditLogs:filterDateRange',
	addFilter: 'auditLogs:addFilter',
	apply: 'auditLogs:apply',
	clearAll: 'auditLogs:clearAll',

	selectPlaceholder: 'auditLogs:selectPlaceholder',
	done: 'auditLogs:done',

	dateFrom: 'auditLogs:dateFrom',
	dateTo: 'auditLogs:dateTo',
	startDate: 'auditLogs:startDate',
	endDate: 'auditLogs:endDate',

	groupPlaceholder: 'auditLogs:groupPlaceholder',
	orEnterId: 'auditLogs:orEnterId',
	selectCollectionHint: 'auditLogs:selectCollectionHint',
	documentIdPlaceholder: 'auditLogs:documentIdPlaceholder',
	update: 'auditLogs:update',
	add: 'auditLogs:add',
	selectEventPlaceholder: 'auditLogs:selectEventPlaceholder',
	eventTypePlaceholder: 'auditLogs:eventTypePlaceholder',
	fieldPathPlaceholder: 'auditLogs:fieldPathPlaceholder',

	selectCollectionPlaceholder: 'auditLogs:selectCollectionPlaceholder',
	userIdPlaceholder: 'auditLogs:userIdPlaceholder',

	searchPlaceholder: 'auditLogs:searchPlaceholder',

	metaIp: 'auditLogs:metaIp',
	metaUa: 'auditLogs:metaUa',
	metaLocale: 'auditLogs:metaLocale',
	sectionSnapshot: 'auditLogs:sectionSnapshot',
	sectionAuthEvent: 'auditLogs:sectionAuthEvent',
	sectionCustomEvent: 'auditLogs:sectionCustomEvent',
	viewGlobal: 'auditLogs:viewGlobal',
	viewDocument: 'auditLogs:viewDocument',
	fieldsChanged: 'auditLogs:fieldsChanged',
	fieldsChangedPlural: 'auditLogs:fieldsChangedPlural',

	diffPath: 'auditLogs:diffPath',
	diffBefore: 'auditLogs:diffBefore',
	diffAfter: 'auditLogs:diffAfter',

	authEventLogin: 'auditLogs:authEventLogin',
	authEventForgotPassword: 'auditLogs:authEventForgotPassword',
	authEventFailedLogin: 'auditLogs:authEventFailedLogin',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
