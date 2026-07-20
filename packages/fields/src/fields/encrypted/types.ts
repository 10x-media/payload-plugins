import type {
	CheckboxField,
	CodeField,
	DateField,
	EmailField,
	JSONField,
	NumberField,
	PointField,
	RadioField,
	RichTextField,
	SelectField,
	TextareaField,
	TextField,
} from 'payload'
import type { DecryptFailurePolicy, KeysConfig } from '../../types'
import type { BidxNormalize } from './crypto/bidx'

export type EncryptedSourceField =
	| CheckboxField
	| CodeField
	| DateField
	| EmailField
	| JSONField
	| NumberField
	| PointField
	| RadioField
	| RichTextField
	| SelectField
	| TextareaField
	| TextField

export type EncryptedSourceType = EncryptedSourceField['type']

export type EncryptedProtection = 'masked' | 'none'

export interface EncryptedFieldOptions {
	keys?: KeysConfig
	/**
	 * Cosmetic number of dots shown while the field is concealed in the admin.
	 * Decoupled from the real value length (unknown until reveal). Clamped to
	 * [1, 64] at the factory; defaults to 8. Ignored by the checkbox facsimile.
	 */
	maskDots?: number
	onDecryptFailure?: DecryptFailurePolicy
	overrides?: (args: { field: TextField }) => TextField
	protection?: EncryptedProtection
	queryable?: boolean
}

/** Request-context modes the encrypted hooks respect (utilities set them). */
export const ENCRYPTED_CONTEXT_KEY = 'tenxFieldsEncrypted'
export type EncryptedContextMode = 'decrypt' | 'raw' | 'rotate'

export const FIELDS_CUSTOM_KEY = '@10x-media/fields'

/**
 * Server-side marker the factory stamps on `field.custom`. `custom` is in
 * Payload's serverOnlyFieldProperties list, so KeysConfig functions never
 * reach the client. Consumed by the query rewrite, boot check, and utilities.
 */
export interface EncryptedFieldMarker {
	bidxName?: string
	fieldName: string
	hasMany: boolean
	keys?: KeysConfig
	localized: boolean
	normalize: BidxNormalize
	onDecryptFailure?: DecryptFailurePolicy
	queryable: boolean
	sourceType: EncryptedSourceType
}

/** Serializable subset shipped to ProtectedField via clientProps. */
export interface EncryptedFieldPatch {
	admin?: Record<string, unknown>
	hasMany?: boolean
	options?: { label: string; value: string }[]
	type: EncryptedSourceType
}

export const getEncryptedMarker = (field: {
	custom?: Record<string, unknown>
}): EncryptedFieldMarker | undefined => {
	const entry = field.custom?.[FIELDS_CUSTOM_KEY]
	if (entry && typeof entry === 'object' && 'encrypted' in entry) {
		return (entry as { encrypted: EncryptedFieldMarker }).encrypted
	}
	return undefined
}
