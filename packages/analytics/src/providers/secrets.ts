import type { FieldHook } from 'payload'

/** Placeholder returned for provider secrets on every read after save. */
export const PROVIDER_SECRET_MASK = '__redacted__'

/**
 * `req.context` flag that opts a provider read into seeing raw secrets. The field
 * `afterRead` mask runs even under `overrideAccess`, so the internal adapter factory
 * read must set it to recover usable credentials.
 */
export const PROVIDER_SECRET_REVEAL_CONTEXT = 'analyticsRevealProviderSecrets'

export const maskSecret: FieldHook = ({ value, req }) => {
	if (req.context[PROVIDER_SECRET_REVEAL_CONTEXT]) {
		return value
	}
	return value ? PROVIDER_SECRET_MASK : value
}

/**
 * Admin form round-trips submit the masked placeholder for an untouched secret;
 * writing it through would destroy the stored credential. Restore the stored value
 * from the raw sibling doc: `previousValue` is unusable here because Payload runs
 * `afterRead` (and so the mask) over the original doc before `beforeChange`.
 */
export const preserveMaskedSecret: FieldHook = ({ value, field, siblingDocWithLocales }) => {
	if (value !== PROVIDER_SECRET_MASK) {
		return value
	}
	const raw = field.name ? siblingDocWithLocales?.[field.name] : undefined
	return raw ?? value
}
