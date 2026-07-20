import type { PayloadRequest } from 'payload'
import { fieldNames, fieldNamesOfType } from '../fields/fieldNamesOfType'
import { interpolate } from '../recall/interpolate'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'

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
