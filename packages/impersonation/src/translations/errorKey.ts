import { keys, type TranslationKey } from './keys'

/** The message key for a failure code an endpoint answers with. */
export const errorKey = (code: string) => {
	const map: Record<string, TranslationKey> = {
		alreadyImpersonating: keys.errorAlreadyImpersonating,
		failed: keys.errorFailed,
		forbidden: keys.errorForbidden,
		impersonatorGone: keys.errorImpersonatorGone,
		impersonatorSessionExpired: keys.errorImpersonatorSessionExpired,
		invalidBody: keys.errorInvalidBody,
		notImpersonating: keys.errorNotImpersonating,
		origin: keys.errorOrigin,
		reasonRequired: keys.errorReasonRequired,
		selfTarget: keys.errorSelfTarget,
		targetNotFound: keys.errorTargetNotFound,
		targetTrashed: keys.errorTargetTrashed,
		targetUnverified: keys.errorTargetUnverified,
		unsupportedAuth: keys.errorUnsupportedAuth,
		unsupportedCollection: keys.errorUnsupportedCollection,
	}
	return map[code] ?? keys.errorFailed
}
