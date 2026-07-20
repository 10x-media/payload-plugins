/**
 * Trimmed, non-empty names of form `fields` rows, optionally filtered to a set of block `types`.
 * Server-safe and defensive: `fields` may be missing, non-array, or contain garbled rows mid-edit.
 * The single source of truth for which field names are selectable and valid as a field reference,
 * so a picker's client options and its server-side existence check cannot drift apart. Any caller
 * mounting `FieldNameSelect` (or validating its stored value) MUST resolve names through here with
 * the same `types` argument (or lack of one) it hands the picker.
 */
const collectNames = (fields: unknown, types: readonly string[] | undefined): string[] => {
	if (!Array.isArray(fields)) {
		return []
	}
	const names: string[] = []
	for (const row of fields) {
		if (!row || typeof row !== 'object') {
			continue
		}
		const { blockType, name } = row as { blockType?: unknown; name?: unknown }
		if (types && (typeof blockType !== 'string' || !types.includes(blockType))) {
			continue
		}
		if (typeof name !== 'string') {
			continue
		}
		const trimmed = name.trim()
		if (trimmed.length > 0) {
			names.push(trimmed)
		}
	}
	return names
}

/** Names of form `fields` blocks whose `blockType` is in `types`. */
export const fieldNamesOfType = (fields: unknown, types: readonly string[]): string[] =>
	collectNames(fields, types)

/** Names of every named form `fields` block, regardless of type. Bare (nameless) blocks are excluded. */
export const fieldNames = (fields: unknown): string[] => collectNames(fields, undefined)
