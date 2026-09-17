/**
 * Typed translation keys. Lookups must go through these constants, not string
 * literals (enforced by requireI18nKeysTyped.grit). Every key here must have a
 * value in every locale (`en.ts`), or it is a type error.
 */
export const keys = {
	actingAs: 'impersonation:actingAs',
	cancel: 'impersonation:cancel',
	collectionPlural: 'impersonation:collectionPlural',
	collectionSingular: 'impersonation:collectionSingular',
	confirm: 'impersonation:confirm',
	confirmTitle: 'impersonation:confirmTitle',
	endSession: 'impersonation:endSession',
	endSessionBody: 'impersonation:endSessionBody',
	errorAlreadyImpersonating: 'impersonation:errorAlreadyImpersonating',
	errorFailed: 'impersonation:errorFailed',
	errorForbidden: 'impersonation:errorForbidden',
	errorImpersonatorGone: 'impersonation:errorImpersonatorGone',
	errorImpersonatorSessionExpired: 'impersonation:errorImpersonatorSessionExpired',
	errorInvalidBody: 'impersonation:errorInvalidBody',
	errorNotImpersonating: 'impersonation:errorNotImpersonating',
	errorOrigin: 'impersonation:errorOrigin',
	errorReasonRequired: 'impersonation:errorReasonRequired',
	errorSelfTarget: 'impersonation:errorSelfTarget',
	errorTargetNotFound: 'impersonation:errorTargetNotFound',
	errorTargetTrashed: 'impersonation:errorTargetTrashed',
	errorTargetUnverified: 'impersonation:errorTargetUnverified',
	errorUnsupportedAuth: 'impersonation:errorUnsupportedAuth',
	errorUnsupportedCollection: 'impersonation:errorUnsupportedCollection',
	fieldEndedAt: 'impersonation:fieldEndedAt',
	fieldEndedBy: 'impersonation:fieldEndedBy',
	fieldImpersonator: 'impersonation:fieldImpersonator',
	fieldMode: 'impersonation:fieldMode',
	fieldReason: 'impersonation:fieldReason',
	fieldStartedAt: 'impersonation:fieldStartedAt',
	fieldTarget: 'impersonation:fieldTarget',
	noResults: 'impersonation:noResults',
	pluginName: 'impersonation:pluginName',
	reasonLabel: 'impersonation:reasonLabel',
	reasonPlaceholder: 'impersonation:reasonPlaceholder',
	returnTo: 'impersonation:returnTo',
	searchUsers: 'impersonation:searchUsers',
	sessionEndsAt: 'impersonation:sessionEndsAt',
	switchToUser: 'impersonation:switchToUser',
} as const

export type TranslationKey = (typeof keys)[keyof typeof keys]
