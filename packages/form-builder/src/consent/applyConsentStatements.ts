import type { ConsentStatements } from './resolveConsentStatements'

/**
 * Merge server-resolved statements onto the consent field instances they belong to, keyed by field
 * name, without mutating the input. A field with no resolved statement (no source picked, or a key
 * the host's sources no longer carry) is left untouched and renders without one.
 */
export const applyConsentStatements = <T extends { name?: string }>(
	fields: T[],
	statements: ConsentStatements
): T[] =>
	fields.map((instance) => {
		const resolved = instance.name ? statements[instance.name] : undefined
		return resolved ? { ...instance, ...resolved } : instance
	})
