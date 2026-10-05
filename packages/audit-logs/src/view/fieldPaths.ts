type FieldLike = {
	fields?: FieldLike[]
	name?: string
	tabs?: { fields: FieldLike[]; name?: string }[]
	type: string
}

/**
 * Inside these the diff records a row id in the path (`sections.<id>.heading`),
 * which no schema can suggest, and join and ui fields store nothing.
 */
const SKIPPED_TYPES = new Set(['array', 'blocks', 'join', 'ui'])

/** Written by Payload on every save or never changed, so never a useful filter. */
const SKIPPED_ROOT_NAMES = new Set(['createdAt', 'id', 'updatedAt'])

const join = (prefix: string, name: string) => (prefix ? `${prefix}.${name}` : name)

/**
 * Changed-path suggestions for one collection or global: every data field outside
 * arrays and blocks, as the dotted path the diff records. Rows, collapsibles,
 * unnamed groups and unnamed tabs add nothing to the path.
 */
export const fieldPaths = (fields: FieldLike[], prefix = ''): string[] =>
	fields.flatMap((field): string[] => {
		if (SKIPPED_TYPES.has(field.type)) return []

		if (field.type === 'tabs') {
			return (field.tabs ?? []).flatMap((tab) =>
				fieldPaths(tab.fields, tab.name ? join(prefix, tab.name) : prefix)
			)
		}

		if (!field.name) return field.fields ? fieldPaths(field.fields, prefix) : []
		if (!prefix && SKIPPED_ROOT_NAMES.has(field.name)) return []

		const path = join(prefix, field.name)
		return field.type === 'group' && field.fields ? fieldPaths(field.fields, path) : [path]
	})
