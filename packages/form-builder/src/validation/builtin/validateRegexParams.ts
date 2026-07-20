import type { PayloadRequest } from 'payload'
import { keys } from '../../translations/keys'
import { asTranslate } from '../../translations/server'

/** Compiles to `undefined` instead of throwing, so callers can branch on validity. */
const tryCompile = (pattern: string, flags?: string): RegExp | undefined => {
	try {
		return new RegExp(pattern, flags)
	} catch {
		return undefined
	}
}

const flagsOf = (siblingData: unknown): string | undefined => {
	const flags = (siblingData as { flags?: unknown } | undefined)?.flags
	return typeof flags === 'string' && flags !== '' ? flags : undefined
}

/**
 * Field-level `validate` for the pattern rule's `flags` param: an unset value is tolerated,
 * otherwise the flag set must be one `RegExp` accepts (an empty source isolates flag validity
 * from pattern validity, so the two params report their own errors).
 * Exported for unit testing.
 */
export const validateRegexFlags = (
	value: unknown,
	{ req }: { req: PayloadRequest; siblingData?: unknown }
): string | true => {
	if (typeof value !== 'string' || value === '') {
		return true
	}
	return tryCompile('', value) ? true : asTranslate(req.t)(keys.validationRegexFlags)
}

/**
 * Field-level `validate` for the pattern rule's `pattern` param. The rule itself fails open on an
 * uncompilable pattern so a bad regex can never break the submit path, which would otherwise let an
 * author save a rule that silently never fires; this catches it at authoring time instead.
 *
 * Compiled against the sibling `flags` because flags decide validity (`\p{Foo}` is a literal
 * without `u` and a syntax error with it). Invalid flags are ignored here and left to
 * `validateRegexFlags`, so a flag typo reports once, on the field that owns it.
 * Exported for unit testing.
 */
export const validateRegexPattern = (
	value: unknown,
	{ req, siblingData }: { req: PayloadRequest; siblingData?: unknown }
): string | true => {
	if (typeof value !== 'string' || value === '') {
		return true
	}
	const flags = flagsOf(siblingData)
	const effectiveFlags = flags && tryCompile('', flags) ? flags : undefined
	return tryCompile(value, effectiveFlags) ? true : asTranslate(req.t)(keys.validationRegexPattern)
}
