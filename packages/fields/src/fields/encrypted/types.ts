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
 * derived by decrypting on read). `prefix + suffix` is capped at 32, enough to
 * carry a constant format prefix (`sk_live_`, `whsec_`) and still say which
 * key this is.
 *
 * The cap is the blunt guard. What decides whether a hint is stored at all is
 * the value being sliced: it must keep at least as many characters hidden as
 * the hint exposes, and at least 8 either way. So one config can sit on a
 * collection holding both long tokens and short ones, hinting the first and
 * silently declining the second, rather than exposing half of it.
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
	/**
	 * Pins the first component of the ciphertext's AAD binding, which otherwise
	 * is the collection or global slug. For a field on a collection whose slug a
	 * consumer can configure (a plugin-owned collection), the slug is a poor
	 * binding: renaming it makes every stored value fail authentication, and no
	 * utility can recover them because reads resolve the binding from the
	 * current slug too. A pinned scope survives the rename.
	 *
	 * Must not contain `.` (the AAD component separator) and must be unique per
	 * logical schema: two fields of the same name sharing a scope share a
	 * binding, which widens the documented same-field ciphertext portability
	 * across their collections. Decide it before data exists; changing it later
	 * is a re-keying event, and stored values become unreadable exactly as a
	 * slug rename would have made them.
	 */
	aadScope?: string
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
	/** Pinned AAD scope; the schema slug when absent. See EncryptedFieldOptions. */
	aadScope?: string
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

/**
 * The AAD's first component for one marker: the pinned scope when the field
 * declares one, else the schema slug the caller resolved. Every construction
 * site goes through this so a pinned scope cannot be honoured on seal and
 * missed on read.
 */
export const aadScopeOf = (marker: EncryptedFieldMarker, slug: string): string =>
	marker.aadScope ?? slug

export const getEncryptedMarker = (field: {
	custom?: Record<string, unknown>
}): EncryptedFieldMarker | undefined => {
	const entry = field.custom?.[FIELDS_CUSTOM_KEY]
	if (entry && typeof entry === 'object' && 'encrypted' in entry) {
		return (entry as { encrypted: EncryptedFieldMarker }).encrypted
	}
	return undefined
}
