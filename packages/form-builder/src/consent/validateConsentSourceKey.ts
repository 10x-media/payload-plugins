import type { TextFieldSingleValidation } from 'payload'
import { text as validateText } from 'payload/shared'
import { keys } from '../translations/keys'
import { asTranslate } from '../translations/server'

/** Walk an object by a path of segments, tolerating a missing branch at any depth. */
const readAt = (root: unknown, segments: (number | string)[]): unknown =>
	segments.reduce<unknown>(
		(node, segment) =>
			node != null && typeof node === 'object'
				? (node as Record<string | number, unknown>)[segment]
				: undefined,
		root
	)

/**
 * Field validator for a consent source row's `key`: runs Payload's default text validation first
 * (so `required` and length still apply), then rejects a key another row in the same array already
 * uses. Two rows sharing a key would shadow silently, both `resolveConsentStatements` and
 * `captureConsent` resolving by `.find()`, while looking authored; the key is the stable reference
 * forms and proofs point at, so it has to be unique. The array's own path is derived from this
 * field's `path` (`[...array, rowIndex, 'key']`), so the check holds wherever the host places the
 * field, nested or on a global.
 */
export const validateConsentSourceKey: TextFieldSingleValidation = (value, args) => {
	const base = validateText(value, args)
	if (base !== true) {
		return base
	}
	if (typeof value !== 'string' || value === '') {
		return true
	}
	const arrayPath = args.path.slice(0, -2)
	const rows = readAt(args.data, arrayPath)
	if (!Array.isArray(rows)) {
		return true
	}
	const occurrences = rows.filter(
		(row) => row != null && typeof row === 'object' && (row as { key?: unknown }).key === value
	).length
	return occurrences > 1 ? asTranslate(args.req.t)(keys.consentSourceKeyDuplicate) : true
}
