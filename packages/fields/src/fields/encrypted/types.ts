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

/**
 * Confidentiality ladder for the admin and API surface. `'none'` renders the
 * native component with the value visible; `'masked'` (default) conceals behind
 * dots with a reveal toggle; `'writeOnly'` additionally strips the field from
 * every read result (REST, GraphQL, Local API) so the plaintext never leaves
 * the server. Write-only values are read deliberately via `readEncryptedField`
 * or `decryptFieldValue`.
 */
export type EncryptedProtection = 'masked' | 'none' | 'writeOnly'

/**
 * Identification hint for a write-only field: how many leading and trailing
 * plaintext characters to store beside the ciphertext at seal time (never
 * derived by decrypting on read). `prefix + suffix` is capped at 8, and a
 * plaintext shorter than `prefix + suffix + 8` stores no hint at all, so a
 * hint can identify a long key but never reconstruct a short secret.
 */
export interface EncryptedHintConfig {
	prefix?: number
	suffix?: number
}

/**
 * Generator for a write-only field's admin Generate action. `true` uses the
 * default: 32 chars of crypto-random base62. Values are generated client-side
 * in the form, so a generated secret is visible and copyable exactly until
 * save, then never again.
 */
export interface EncryptedGenerateConfig {
	/** Generated length excluding the prefix. Integer in [8, 128], rejected otherwise; default 32. */
	length?: number
	/** Literal prefix, e.g. 'whsec_'. Counts toward the hint but not `length`. */
	prefix?: string
	/** Alphabet to sample from: 10 to 256 distinct code points (duplicates collapse). Default base62. */
	charset?: string
}

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
	/**
	 * Write-only fields only: whether the admin offers the clear (×) action.
	 * Defaults to `true` for optional fields and is forced off for `required`
	 * ones (clearing a required secret could never save).
	 */
	clearable?: boolean
	/** Write-only text/email fields only: store an identification hint. */
	hint?: EncryptedHintConfig
	/** Write-only text fields only: enable the admin Generate action. */
	generate?: true | EncryptedGenerateConfig
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
	/** Name of the virtual set-indicator sibling; present only when `writeOnly`. */
	setName?: string
	/** Normalized hint config; present only when `writeOnly` with a hint. */
	hint?: { prefix: number; suffix: number }
	/** Name of the stored hint sibling; present only when `hint` is. */
	hintName?: string
	sourceType: EncryptedSourceType
	writeOnly: boolean
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
