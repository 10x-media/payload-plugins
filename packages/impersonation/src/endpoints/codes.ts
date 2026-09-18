export const FAILURE_CODES = [
	'alreadyImpersonating',
	'failed',
	'forbidden',
	'impersonatorGone',
	'impersonatorSessionExpired',
	'invalidBody',
	'notImpersonating',
	'origin',
	'reasonRequired',
	'selfTarget',
	'targetNotFound',
	'targetTrashed',
	'targetUnverified',
	'unsupportedAuth',
	'unsupportedCollection',
] as const

export type FailureCode = (typeof FAILURE_CODES)[number]
