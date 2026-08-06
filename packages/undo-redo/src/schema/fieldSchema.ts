import { UNDO_REDO_FIELD_KEY, type UndoRedoFieldConfig } from './fieldConfig'

/**
 * Walks a Payload field schema and flattens it into the path patterns the
 * history matcher speaks, annotating each with the field's type and whether the
 * host opted it out of undo/redo.
 *
 * This exists because form state carries no type information: `FormField` has a
 * `fieldSchema` member, but only when `buildFormState` is called with
 * `includeSchema: true`, which the document edit view never does. The client
 * config is the only place a mounted component can learn that `layout.0.body`
 * is rich text rather than a plain string.
 *
 * Row indexes collapse to `*`, because a schema describes every row at once:
 * an array `list` containing `title` yields `list.*.title`, which the matcher
 * then tests against the concrete `list.0.title`.
 */

/** The structural shape this walk needs, satisfied by both `Field` and `ClientField`. */
export interface WalkableField {
	type: string
	name?: string
	fields?: WalkableField[]
	blocks?: (WalkableBlock | string)[]
	blockReferences?: (WalkableBlock | string)[]
	tabs?: WalkableTab[]
	admin?: {
		custom?: Record<string, unknown>
	}
}

export interface WalkableBlock {
	slug: string
	fields: WalkableField[]
}

export interface WalkableTab {
	name?: string
	fields: WalkableField[]
}

export interface FieldSchemaEntry {
	/** Form-state path pattern, with `*` standing in for every array or blocks row index. */
	pattern: string
	/**
	 * The field's type, or `undefined` when the pattern is ambiguous: two blocks
	 * in one blocks field can declare the same field name with different types,
	 * and a form-state path carries no block discriminator to tell them apart.
	 * Callers must treat `undefined` as "unknown" and fall back to inspecting the
	 * value, never as "no field here".
	 */
	type: string | undefined
	/** Every type seen at this pattern, so ambiguity is inspectable rather than silent. */
	types: string[]
	/**
	 * Whether any contributor marked the field opted out. Ambiguous patterns
	 * resolve by OR: honouring an opt-out that was meant for a sibling block is
	 * the safe direction, ignoring one the host asked for is not.
	 */
	disabled: boolean
}

export type FieldSchemaMap = Map<string, FieldSchemaEntry>

/**
 * Guards against a blocks field that reaches itself through a slug reference,
 * which Payload allows and which is the main reason `blockReferences` exists.
 * Recursion is bounded by the set of block slugs already open on the current
 * branch, so a self-referencing block contributes its fields exactly once.
 */
type WalkContext = {
	blocksMap: Record<string, WalkableBlock> | undefined
	map: FieldSchemaMap
	openBlocks: Set<string>
}

const readFieldConfig = (field: WalkableField): UndoRedoFieldConfig | undefined =>
	field.admin?.custom?.[UNDO_REDO_FIELD_KEY] as UndoRedoFieldConfig | undefined

const record = (context: WalkContext, pattern: string, field: WalkableField): void => {
	const disabled = readFieldConfig(field)?.disabled === true
	const existing = context.map.get(pattern)
	if (!existing) {
		context.map.set(pattern, {
			pattern,
			type: field.type,
			types: [field.type],
			disabled,
		})
		return
	}
	if (!existing.types.includes(field.type)) {
		existing.types.push(field.type)
		existing.type = undefined
	}
	existing.disabled ||= disabled
}

const join = (parent: string, segment: string): string =>
	parent === '' ? segment : `${parent}.${segment}`

/** `blockReferences` wins when present: Payload populates one or the other. */
const resolveBlocks = (field: WalkableField): (WalkableBlock | string)[] =>
	field.blockReferences ?? field.blocks ?? []

const walkBlock = (block: WalkableBlock | string, parent: string, context: WalkContext): void => {
	const resolved = typeof block === 'string' ? context.blocksMap?.[block] : block
	// An unresolvable slug means the caller had no blocks map. Skipping keeps the
	// rest of the schema usable rather than throwing over one missing definition.
	if (!resolved || context.openBlocks.has(resolved.slug)) return
	context.openBlocks.add(resolved.slug)
	walkFields(resolved.fields, parent, context)
	context.openBlocks.delete(resolved.slug)
}

const walkFields = (fields: WalkableField[], parent: string, context: WalkContext): void => {
	for (const field of fields) {
		// UI fields never reach the data, so they never appear in form state.
		if (field.type === 'ui') continue

		if (field.type === 'tabs') {
			for (const tab of field.tabs ?? []) {
				// A named tab adds a segment; an unnamed one leaves its children
				// where they were, exactly like a row or an unnamed group.
				walkFields(tab.fields, tab.name ? join(parent, tab.name) : parent, context)
			}
			continue
		}

		// Rows, collapsibles and unnamed groups are presentational: Payload gives
		// them an `_index-N` path of their own but strips it again for their
		// children, so they contribute nothing here.
		if (!field.name) {
			if (field.fields) walkFields(field.fields, parent, context)
			continue
		}

		const path = join(parent, field.name)
		record(context, path, field)

		if (field.type === 'array' || field.type === 'blocks') {
			const rowParent = join(path, '*')
			if (field.type === 'blocks') {
				for (const block of resolveBlocks(field)) {
					walkBlock(block, rowParent, context)
				}
			}
			if (field.fields) walkFields(field.fields, rowParent, context)
			continue
		}

		if (field.fields) walkFields(field.fields, path, context)
	}
}

/**
 * Flatten `fields` into a pattern map.
 *
 * Pass `blocksMap` (the client config's `blocksMap`) whenever the schema may use
 * slug-based `blockReferences`; without it those blocks are skipped, since their
 * definitions live on the config rather than on the field.
 */
export const buildFieldSchemaMap = (
	fields: WalkableField[],
	options: { blocksMap?: Record<string, WalkableBlock> } = {}
): FieldSchemaMap => {
	const context: WalkContext = {
		blocksMap: options.blocksMap,
		map: new Map(),
		openBlocks: new Set(),
	}
	walkFields(fields, '', context)
	return context.map
}

/**
 * The patterns the history should ignore, from both opt-out sources: fields
 * marked through `admin.custom`, and whole field types the host excluded.
 *
 * Container patterns already cover their subtree (see pathPatterns), so an
 * opted-out group or array needs no entry for its children.
 */
export const collectIgnorePatterns = (
	map: FieldSchemaMap,
	ignoreFieldTypes: readonly string[] = []
): string[] => {
	const types = new Set(ignoreFieldTypes)
	const patterns: string[] = []
	for (const entry of map.values()) {
		if (entry.disabled || entry.types.some((type) => types.has(type))) {
			patterns.push(entry.pattern)
		}
	}
	return patterns
}
