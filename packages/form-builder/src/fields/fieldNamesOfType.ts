/**
 * Names of form `fields` blocks whose `blockType` is in `types`, trimmed and non-empty.
 * Server-safe and defensive: `fields` may be missing, non-array, or contain garbled rows
 * mid-edit. The single source of truth for which field names are selectable and valid as
 * a field reference (e.g. the confirmation action's `toField`), so client options and
 * server validation cannot drift apart.
 */
export const fieldNamesOfType = (fields: unknown, types: readonly string[]): string[] => {
	if (!Array.isArray(fields)) {
		return []
	}
	const names: string[] = []
	for (const row of fields) {
		if (!row || typeof row !== 'object') {
			continue
		}
		const { blockType, name } = row as { blockType?: unknown; name?: unknown }
		if (typeof blockType !== 'string' || !types.includes(blockType)) {
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
