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

/** Anything that can carry this plugin's per-field opt-out. */
interface CustomCarrier {
	admin?: {
		custom?: Record<string, unknown>
	}
}

/** The structural shape this walk needs, satisfied by both `Field` and `ClientField`. */
export interface WalkableField extends CustomCarrier {
	type: string
	name?: string
	fields?: WalkableField[]
	blocks?: (WalkableBlock | string)[]
	blockReferences?: (WalkableBlock | string)[]
	tabs?: WalkableTab[]
}

export interface WalkableBlock {
	slug: string
	fields: WalkableField[]
}

export interface WalkableTab extends CustomCarrier {
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

/**
 * Where the walk currently is: the path prefix, and whether an ancestor opted
 * its subtree out *without leaving a pattern behind*.
 *
 * That qualifier is the whole reason the flag exists. A named group or array
 * records a pattern of its own, and a pattern covers its whole subtree, so an
 * opt-out there needs no help travelling downwards. Tabs and unnamed rows,
 * collapsibles and groups contribute no path segment and therefore no pattern,
 * so theirs would be lost unless it is carried to the first descendant that
 * does record one.
 */
interface WalkScope {
	parent: string
	disabled: boolean
}

const readFieldConfig = (field: CustomCarrier): UndoRedoFieldConfig | undefined =>
	field.admin?.custom?.[UNDO_REDO_FIELD_KEY] as UndoRedoFieldConfig | undefined

const isDisabled = (field: CustomCarrier): boolean => readFieldConfig(field)?.disabled === true

const record = (
	context: WalkContext,
	pattern: string,
	found: { disabled: boolean; type: string }
): void => {
	const existing = context.map.get(pattern)
	if (!existing) {
		context.map.set(pattern, {
			pattern,
			type: found.type,
			types: [found.type],
			disabled: found.disabled,
		})
		return
	}
	if (!existing.types.includes(found.type)) {
		existing.types.push(found.type)
		existing.type = undefined
	}
	existing.disabled ||= found.disabled
}

const join = (parent: string, segment: string): string =>
	parent === '' ? segment : `${parent}.${segment}`

/** `blockReferences` wins when present: Payload populates one or the other. */
const resolveBlocks = (field: WalkableField): (WalkableBlock | string)[] =>
	field.blockReferences ?? field.blocks ?? []

const walkBlock = (block: WalkableBlock | string, scope: WalkScope, context: WalkContext): void => {
	const resolved = typeof block === 'string' ? context.blocksMap?.[block] : block
	// An unresolvable slug means the caller had no blocks map. Skipping keeps the
	// rest of the schema usable rather than throwing over one missing definition.
	if (!resolved || context.openBlocks.has(resolved.slug)) return
	context.openBlocks.add(resolved.slug)
	walkFields(resolved.fields, scope, context)
	context.openBlocks.delete(resolved.slug)
}

const walkFields = (fields: WalkableField[], scope: WalkScope, context: WalkContext): void => {
	for (const field of fields) {
		// UI fields never reach the data, so they never appear in form state.
		if (field.type === 'ui') continue

		if (field.type === 'tabs') {
			const disabled = scope.disabled || isDisabled(field)
			for (const tab of field.tabs ?? []) {
				// A named tab adds a segment; an unnamed one leaves its children
				// where they were, exactly like a row or an unnamed group. Neither
				// records a pattern, so an opt-out on the tabs field or on the tab
				// itself has to continue downwards.
				walkFields(
					tab.fields,
					{
						disabled: disabled || isDisabled(tab),
						parent: tab.name ? join(scope.parent, tab.name) : scope.parent,
					},
					context
				)
			}
			continue
		}

		// Rows, collapsibles and unnamed groups are presentational: Payload gives
		// them an `_index-N` path of their own but strips it again for their
		// children, so they contribute nothing here beyond their opt-out.
		if (!field.name) {
			if (field.fields) {
				walkFields(
					field.fields,
					{ disabled: scope.disabled || isDisabled(field), parent: scope.parent },
					context
				)
			}
			continue
		}

		const path = join(scope.parent, field.name)
		record(context, path, { disabled: scope.disabled || isDisabled(field), type: field.type })
		// This field now has a pattern of its own, which covers everything below
		// it, so the inherited flag has done its job and stops here rather than
		// producing a redundant entry per descendant.
		const childScope = { disabled: false, parent: path }

		if (field.type === 'array' || field.type === 'blocks') {
			const rowScope = { disabled: false, parent: join(path, '*') }
			if (field.type === 'blocks') {
				for (const block of resolveBlocks(field)) {
					walkBlock(block, rowScope, context)
				}
			}
			if (field.fields) walkFields(field.fields, rowScope, context)
			continue
		}

		if (field.fields) walkFields(field.fields, childScope, context)
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
	walkFields(fields, { disabled: false, parent: '' }, context)
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

/**
 * The patterns whose field type is *unambiguously* `type`.
 *
 * Ambiguous patterns are left out, the opposite of how `collectIgnorePatterns`
 * resolves them. Over-matching is the safe direction for an opt-out, because
 * the cost is a field the host did not ask to exclude staying out of the
 * history. It is the unsafe direction here: callers use this to decide how to
 * read a *value*, and applying a JSON field's reading to a text field that
 * shares its path pattern in a sibling block would quietly stop that text field
 * from being captured.
 */
export const collectPatternsOfType = (map: FieldSchemaMap, type: string): string[] => {
	const patterns: string[] = []
	for (const entry of map.values()) {
		if (entry.type === type) patterns.push(entry.pattern)
	}
	return patterns
}
