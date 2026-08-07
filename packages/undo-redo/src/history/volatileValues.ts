import { collectPatternsOfType, type FieldSchemaMap } from '../schema/fieldSchema'
import type { VolatileMatcher } from './historyCore'
import { createPathMatcher } from './pathPatterns'

/**
 * Recognising form-state values that are a field mid-edit rather than data, so
 * the history can decline to record a state it would not be able to restore.
 *
 * Only Payload's JSON field needs this today. Every other field type keeps its
 * editing surface and its form value in the same representation, so whatever
 * the value holds can be dispatched straight back.
 */

/**
 * True for a value Payload's JSON field is holding as raw editor text rather
 * than as parsed data.
 *
 * The field parses on every keystroke and, when the parse throws, writes the
 * editor's text into form state as a string (see @payloadcms/ui fields/JSON,
 * `handleChange`). A string that is not itself valid JSON therefore came from
 * that branch: it is text the editor has not finished, not a value.
 *
 * A JSON field legitimately holding a bare string is indistinguishable from
 * that, since both arrive as a string that does not parse, and Payload keeps no
 * error flag in form state to tell them apart. Reading it as mid-edit is the
 * harmless direction: the path drops out of the history until it holds
 * something else, which is exactly what an ignored path does.
 */
export const isUnparsedJson = (value: unknown): boolean => {
	if (typeof value !== 'string') return false
	try {
		JSON.parse(value)
		return false
	} catch {
		return true
	}
}

/**
 * Build the history's volatile matcher from a document's schema.
 *
 * An empty map yields a matcher that is never true, which is also what a
 * document whose schema could not be resolved should get: capturing a value the
 * restore may mangle is worse than the alternative, but guessing which paths
 * are JSON without a schema would be worse still.
 */
export const createVolatileMatcher = (map: FieldSchemaMap): VolatileMatcher => {
	const isJsonPath = createPathMatcher(collectPatternsOfType(map, 'json'))
	return (path, field) => isJsonPath(path) && isUnparsedJson(field.value)
}
