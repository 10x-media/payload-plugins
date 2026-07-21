import type { PayloadRequest, TextField } from 'payload'
import { fieldNames, fieldNamesOfType } from '../fields/fieldNamesOfType'
import { localizedIf } from '../fields/localizedIf'
import { interpolate } from '../recall/interpolate'
import { keys } from '../translations/keys'
import { asTranslate, labelFor } from '../translations/server'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOKEN_RE = /^\{\{\s*([\w.-]+)\s*\}\}$/

/** A plausible email address (a permissive shape check, not full RFC validation). */
export const isPlausibleEmail = (value: string): boolean => EMAIL_RE.test(value.trim())

/** The field name inside a `{{name}}` recipient token, or undefined when the string is not a token. */
export const parseFieldToken = (value: string): string | undefined => {
	const match = TOKEN_RE.exec(value.trim())
	return match ? match[1] : undefined
}

export const isFieldToken = (value: string): boolean => parseFieldToken(value) !== undefined

const toList = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: typeof value === 'string' && value.length > 0
			? [value]
			: []

/**
 * Resolve a stored recipient value (a `string[]`, or a legacy single string) to the comma-separated
 * list `payload.sendEmail` accepts: each entry is interpolated (a `{{field}}` token resolves from the
 * submission, a plain email passes through), trimmed, empties dropped, joined with `, `.
 */
export const resolveRecipients = (value: unknown, resolve: (name: string) => string): string =>
	toList(value)
		.map((entry) => interpolate(entry, resolve).trim())
		.filter((entry) => entry.length > 0)
		.join(', ')

/**
 * Field `validate` for a recipient list: unset is fine; otherwise every entry must be a valid email
 * or a `{{field}}` token naming an existing field of an allowed token type (`tokenFieldTypes`, or any
 * named field when empty). Reads the form's `fields` off `data`, like the confirmation `toField`.
 */
export const validateRecipients =
	(tokenFieldTypes?: string[]) =>
	(value: unknown, { data, req }: { data?: unknown; req: PayloadRequest }): string | true => {
		const list = toList(value)
		if (list.length === 0) {
			return true
		}
		const fields =
			data && typeof data === 'object' ? (data as Record<string, unknown>).fields : undefined
		const allowed = new Set(
			tokenFieldTypes && tokenFieldTypes.length > 0
				? fieldNamesOfType(fields, tokenFieldTypes)
				: fieldNames(fields)
		)
		for (const entry of list) {
			const token = parseFieldToken(entry)
			if (token) {
				if (!allowed.has(token)) {
					return asTranslate(req.t)(keys.validationRecipientUnknownField)
				}
				continue
			}
			if (!isPlausibleEmail(entry)) {
				return asTranslate(req.t)(keys.validationRecipientInvalid)
			}
		}
		return true
	}

/** Host-configurable behavior for the recipient fields (plugin option `email.recipients`). */
export type RecipientsConfig = {
	/** Allow free-typed emails (default true). */
	allowCustom?: boolean
	/** Offer the form's own fields as recipient tokens (default true). */
	fieldTokens?: boolean
	/** Field types eligible as tokens (default `['email']`). */
	tokenFieldTypes?: string[]
}

const RECIPIENTS_FIELD_REF = '@10x-media/form-builder/client#RecipientsSelect'

/**
 * A `text hasMany` field rendered by `RecipientsSelect`, used for every email address list. `endpoint`
 * (when set) supplies preset options (e.g. the host's departments); `recipients` narrows the field's
 * behavior; `width` sets `admin.width` so a pair can share a row.
 */
// biome-ignore lint/complexity/useMaxParams: the field identity (name, label, localize) plus its grouped options is the minimal surface
export const buildRecipientField = (
	name: string,
	labelKey: string,
	localize: boolean,
	opts: { endpoint?: string; recipients?: RecipientsConfig; width?: string } = {}
): TextField => ({
	name,
	type: 'text',
	hasMany: true,
	label: labelFor(labelKey),
	validate: validateRecipients(opts.recipients?.tokenFieldTypes ?? ['email']),
	...localizedIf(localize),
	admin: {
		...(opts.width ? { width: opts.width } : {}),
		components: {
			Field: {
				path: RECIPIENTS_FIELD_REF,
				clientProps: {
					...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
					...(opts.recipients?.allowCustom === false ? { allowCustom: false } : {}),
					...(opts.recipients?.fieldTokens === false ? { fieldTokens: false } : {}),
					...(opts.recipients?.tokenFieldTypes
						? { tokenFieldTypes: opts.recipients.tokenFieldTypes }
						: {}),
				},
			},
		},
	},
})
