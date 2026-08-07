import type { FormState } from 'payload'

import { createPathMatcher, type PathMatcher } from './pathPatterns'

/**
 * Pure, React-free core of the admin undo/redo feature.
 *
 * The admin form keeps its state in a flat `FormState` map (path → FieldState).
 * We snapshot that map on (debounced) user edits and restore old snapshots via
 * the form's `REPLACE_STATE` reducer action. Field states carry non-serializable
 * members (React nodes in `customComponents`, `validate` functions), so snapshots
 * shallow-copy each field state and keep those members by reference: only the
 * top level is protected against later mutation, which matches how the form
 * reducer itself treats field states (immutable-style replacement).
 */

/**
 * Payload's own fields, which no editor edits directly and undo must never
 * touch. They change on save, autosave, publish and token refresh without user
 * interaction, so treating them as edits would create "phantom" history entries
 * where undo appears to do nothing, and restoring a stale value could revert a
 * publish (`_status`) or corrupt auth state (`sessions`, `salt`, `hash`).
 *
 * Deliberately limited to fields Payload itself injects. Derived fields that a
 * plugin or project adds are user-facing (a project may well have its own
 * `pathname`), so excluding those is the host's call through `ignorePaths`
 * rather than a default baked in here.
 *
 * Each entry ignores its whole subtree, which is what the pattern matcher does
 * for a pattern that runs out before the path does.
 */
export const DEFAULT_IGNORED_PATHS = [
	'_status',
	'createdAt',
	'hash',
	'lockUntil',
	'loginAttempts',
	'resetPasswordExpiration',
	'resetPasswordToken',
	'salt',
	'sessions',
	'updatedAt',
] as const

/** True for paths the undo history ignores entirely (see DEFAULT_IGNORED_PATHS). */
export const isIgnoredPath: PathMatcher = createPathMatcher(DEFAULT_IGNORED_PATHS)

export interface ComparableField {
	/** Absent for array and blocks fields, whose `value` carries no information (see extractComparableField). */
	value?: unknown
	/** Row ids in order, which captures array/blocks row additions, deletions and moves. */
	rowIds?: (string | undefined)[]
}

/** The slice of form state that counts as a user-visible edit. */
export type ComparableState = Record<string, ComparableField>

export interface HistoryEntry {
	/**
	 * Monotonic id, stable across the stack shifting when the cap evicts the
	 * oldest entries. Positional indexes are not stable for that reason, so
	 * anything keyed per entry (React keys, debug UI expansion) uses this.
	 */
	id: number
	fields: FormState
	comparable: ComparableState
}

export const MAX_HISTORY_ENTRIES = 50

/**
 * True for a field whose current value the history cannot put back.
 *
 * Payload's JSON field is the case this exists for. While its text does not
 * parse, the field writes the raw editor text into form state as a string, and
 * the editor is then rendered from `JSON.stringify(value)`, so dispatching that
 * string back would show it double-encoded rather than as the text the editor
 * had. No value we could dispatch reproduces broken text, so rather than record
 * a state it cannot honour, a capture carries the last value it can (see
 * pushSnapshot).
 */
export type VolatileMatcher = (path: string, field: FormState[string]) => boolean

/**
 * Per-history settings. They live on the history object rather than being
 * threaded through every call so that a snapshot and the restore built from it
 * can never disagree about which paths are in scope.
 */
export interface HistoryOptions {
	/** Paths excluded from capture and from restore. */
	isIgnored: PathMatcher
	/** Paths whose live value is captured as the previous entry's instead. */
	isVolatile: VolatileMatcher
	/** Entries kept before the oldest is evicted. */
	maxHistory: number
}

export interface UndoHistory {
	stack: HistoryEntry[]
	/** Index of the entry representing the current form state. */
	index: number
	/**
	 * The comparable state of the persisted document, or null before anything has
	 * been saved or loaded.
	 *
	 * This is what makes the "leave without saving" prompt truthful in both
	 * directions. Undoing back to the *first* entry is not the same as being
	 * unsaved: after a save, the baseline moves to wherever the document was
	 * saved from, and stepping back past that point is a real unsaved change even
	 * though the form looks like it did on load.
	 *
	 * Held as a value rather than an index on purpose. An index has to be
	 * renumbered when the cap evicts entries and invalidated when a new edit
	 * drops the redo tail, and recording one meant pushing a snapshot at save
	 * time, which truncated the redo tail through the very branch redo was about
	 * to walk into. A value needs none of that bookkeeping and lets the baseline
	 * be recorded without touching the stack at all.
	 */
	savedComparable: ComparableState | null
	options: HistoryOptions
}

export const DEFAULT_HISTORY_OPTIONS: HistoryOptions = {
	isIgnored: isIgnoredPath,
	isVolatile: () => false,
	maxHistory: MAX_HISTORY_ENTRIES,
}

/**
 * Structural deep equality for JSON-ish data (objects, arrays, primitives).
 * Key order is irrelevant; `undefined` properties equal missing properties.
 */
export const deepEqual = (a: unknown, b: unknown): boolean => {
	if (a === b) return true
	if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b)
	if (a == null || b == null) return a === b
	if (typeof a !== 'object' || typeof b !== 'object') return false
	if (Array.isArray(a) !== Array.isArray(b)) return false
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false
		return a.every((item, i) => deepEqual(item, b[i]))
	}
	const aObj = a as Record<string, unknown>
	const bObj = b as Record<string, unknown>
	const keys = new Set([...Object.keys(aObj), ...Object.keys(bObj)])
	for (const key of keys) {
		if (!deepEqual(aObj[key], bObj[key])) return false
	}
	return true
}

/**
 * Reduce a field state to what counts as a user-visible edit.
 *
 * For array and blocks fields the row ids are the whole story, and `value` is
 * deliberately dropped: Payload sets it to the row count, which `rowIds` already
 * encodes, and uses it as a "no data" marker in a way that changes without any
 * edit. A localized blocks field with no value in the active locale is built
 * with `value: null`, and the next form-state build, triggered by an edit to
 * some unrelated field, rewrites it to `0` (arrays do the same between
 * `undefined` and `0`, see @payloadcms/ui addFieldStatePromise).
 *
 * Comparing that would report an edit nobody made. Worse, the phantom lands on
 * the capture that runs at the start of the next restore, which appends an
 * entry and truncates the redo tail, so redo silently stops working after the
 * first undo.
 */
const extractComparableField = (field: FormState[string]): ComparableField =>
	field.rows ? { rowIds: field.rows.map((row) => row.id) } : { value: field.value }

export const extractComparable = (
	fields: FormState,
	isIgnored: PathMatcher = isIgnoredPath
): ComparableState => {
	const out: ComparableState = {}
	for (const [path, field] of Object.entries(fields)) {
		if (isIgnored(path) || !field) continue
		out[path] = extractComparableField(field)
	}
	return out
}

let nextEntryId = 0

export const createSnapshot = (
	fields: FormState,
	isIgnored: PathMatcher = isIgnoredPath
): HistoryEntry => ({
	id: nextEntryId++,
	fields: Object.fromEntries(Object.entries(fields).map(([path, field]) => [path, { ...field }])),
	comparable: extractComparable(fields, isIgnored),
})

export const createHistory = (options: Partial<HistoryOptions> = {}): UndoHistory => ({
	stack: [],
	index: -1,
	savedComparable: null,
	options: { ...DEFAULT_HISTORY_OPTIONS, ...options },
})

/**
 * Record `fields` as the persisted state. Call whenever the form becomes clean:
 * a save, an autosave, a reset, the initial load.
 *
 * Reads the live form state rather than the stack, so a save made with edits
 * still inside the capture debounce is recorded accurately, and does not append
 * an entry, so it can never disturb the redo tail.
 */
export const markSaved = (history: UndoHistory, fields: FormState): void => {
	history.savedComparable = projectComparable(history, fields)
}

/** True when the form matches the persisted document, so it can be reported clean. */
export const isAtSavedState = (history: UndoHistory): boolean => {
	if (!history.savedComparable) return false
	const current = history.stack[history.index]
	return current !== undefined && deepEqual(current.comparable, history.savedComparable)
}

/**
 * What a volatile path contributes to a snapshot: whatever the previous entry
 * recorded for it, or, with no entry to carry from, the live field reverted to
 * its `initialValue`, which is the persisted value and therefore a state the
 * document really was in.
 */
const carryForward = (
	path: string,
	live: FormState[string],
	previous: HistoryEntry | undefined
): { comparable: ComparableField; field: FormState[string] } => {
	const carried = previous?.fields[path]
	if (carried) {
		return {
			comparable: previous?.comparable[path] ?? extractComparableField(carried),
			field: carried,
		}
	}
	const reverted = { ...live, value: live.initialValue }
	return { comparable: extractComparableField(reverted), field: reverted }
}

/**
 * Every volatile, non-ignored path of `fields`, mapped to what it carries
 * forward from the entry the form currently shows.
 */
const collectCarried = (
	history: UndoHistory,
	fields: FormState
): Map<string, { comparable: ComparableField; field: FormState[string] }> => {
	const { isIgnored, isVolatile } = history.options
	const previous = history.stack[history.index]
	const out = new Map<string, { comparable: ComparableField; field: FormState[string] }>()
	for (const [path, field] of Object.entries(fields)) {
		if (!field || isIgnored(path) || !isVolatile(path, field)) continue
		out.set(path, carryForward(path, field, previous))
	}
	return out
}

/**
 * The comparable state a capture of `fields` would record right now, carry
 * forward included.
 *
 * The debug overlay diffs live form state against this rather than against a
 * plain extract, so a value that can never be captured does not show up as a
 * change that is forever pending.
 */
export const projectComparable = (history: UndoHistory, fields: FormState): ComparableState => {
	const out = extractComparable(fields, history.options.isIgnored)
	for (const [path, carried] of collectCarried(history, fields)) {
		out[path] = carried.comparable
	}
	return out
}

/**
 * Push the current form state onto the history. No-ops (and returns false) when
 * nothing user-visible changed relative to the entry at the current index,
 * which absorbs server-merge echoes after saves/restores. A real change drops
 * the redo tail, appends, and caps the stack at the history's `maxHistory`.
 */
export const pushSnapshot = (history: UndoHistory, fields: FormState): boolean => {
	const { isIgnored, maxHistory } = history.options
	const snapshot = createSnapshot(fields, isIgnored)
	const current = history.stack[history.index]
	// Substituting here rather than at restore time is what keeps the stack
	// honest: an entry's comparable always matches what restoring it produces, so
	// a restore cannot land on a state that differs from its own entry and have
	// the next capture record that difference as a phantom edit, truncating the
	// redo tail.
	for (const [path, carried] of collectCarried(history, fields)) {
		snapshot.fields[path] = carried.field
		snapshot.comparable[path] = carried.comparable
	}
	if (current && deepEqual(current.comparable, snapshot.comparable)) return false
	history.stack.splice(history.index + 1)
	history.stack.push(snapshot)
	if (history.stack.length > maxHistory) {
		history.stack.splice(0, history.stack.length - maxHistory)
	}
	history.index = history.stack.length - 1
	return true
}

/** A single path-level change between two comparable states. */
export interface ComparableDiff {
	path: string
	from: unknown
	to: unknown
	/** Set only when the path carries array/blocks rows and those rows changed. */
	fromRowIds?: (string | undefined)[]
	toRowIds?: (string | undefined)[]
	/** Whether the path itself appeared or disappeared between the two states. */
	presence?: 'added' | 'removed'
}

/**
 * Path-level changes from one comparable state to another, sorted by path.
 * Powers the debug overlay and makes "what did this history entry capture?"
 * answerable without diffing whole FormState objects by eye.
 */
export const diffComparable = (from: ComparableState, to: ComparableState): ComparableDiff[] => {
	const out: ComparableDiff[] = []
	for (const path of new Set([...Object.keys(from), ...Object.keys(to)])) {
		const a = from[path]
		const b = to[path]
		if (a && b && deepEqual(a.value, b.value) && deepEqual(a.rowIds, b.rowIds)) continue
		const diff: ComparableDiff = { path, from: a?.value, to: b?.value }
		if (a?.rowIds || b?.rowIds) {
			diff.fromRowIds = a?.rowIds
			diff.toRowIds = b?.rowIds
		}
		if (!a) diff.presence = 'added'
		else if (!b) diff.presence = 'removed'
		out.push(diff)
	}
	return out.sort((x, y) => x.path.localeCompare(y.path))
}

export const canUndo = (history: UndoHistory): boolean => history.index > 0

export const canRedo = (history: UndoHistory): boolean =>
	history.index >= 0 && history.index < history.stack.length - 1

/** Lexical editor state values have the shape `{ root: { children: [...] } }`. */
const isLexicalValue = (value: unknown): boolean => {
	if (value == null || typeof value !== 'object') return false
	const root = (value as Record<string, unknown>).root
	return root != null && typeof root === 'object' && 'children' in (root as object)
}

const cloneJson = <T>(value: T): T =>
	value == null ? value : (JSON.parse(JSON.stringify(value)) as T)

/**
 * A value that means the same as `live` but is never `Object.is` to it.
 *
 * Lexical only re-initializes a mounted editor when the `initialValue` it is
 * handed is a different *reference* from the one it last saw, so restoring has
 * to hand it a new one. Cloning covers that for an editor state object, but not
 * for a rich text field that was never saved, whose initialValue is nullish: a
 * primitive cannot be cloned into a fresh identity, and `null` re-sent as
 * `null` looks unchanged.
 *
 * Undo appeared to work there because it swapped `undefined` for `null`, which
 * is an identity change once. Every restore after it kept sending `null` and
 * the editor stayed on screen holding stale content, even though the form value
 * underneath had been restored, which is why saving made the change appear.
 * Alternating between the two nullish values keeps every restore distinguishable
 * while leaving the meaning, "this field started out empty", untouched.
 */
const withNewIdentity = (live: unknown): unknown => {
	if (live === null) return undefined
	if (live === undefined) return null
	return cloneJson(live)
}

/**
 * Build the FormState to dispatch via REPLACE_STATE when restoring `snapshot`.
 *
 * - `initialValue` is taken from the live state, not the snapshot, so Payload's
 *   modified/"leave without saving" detection stays truthful after save cycles.
 * - Changed fields get `isModified: true`, which stops a stale in-flight
 *   autosave response from overwriting the restored value during the server
 *   form-state merge (local modified fields win in `mergeServerFormState`).
 * - Changed rich text fields additionally get a *new* `initialValue` reference:
 *   the mounted Lexical editor only re-initializes from the form value when the
 *   initialValue reference changes (see @payloadcms/richtext-lexical Field.tsx).
 */
export const buildRestoreState = (
	snapshot: HistoryEntry,
	currentFields: FormState,
	isIgnored: PathMatcher = isIgnoredPath
): FormState => {
	const out: FormState = {}
	for (const [path, snapField] of Object.entries(snapshot.fields)) {
		if (isIgnored(path)) continue
		const cur = currentFields[path]
		const snapComparable = snapshot.comparable[path] ?? extractComparableField(snapField)
		const changed = !cur || !deepEqual(snapComparable, extractComparableField(cur))
		const restored: FormState[string] = { ...snapField }
		if (cur) restored.initialValue = cur.initialValue
		if (changed) {
			restored.isModified = true
			if (isLexicalValue(snapField.value) || isLexicalValue(cur?.value)) {
				restored.initialValue = withNewIdentity(cur?.initialValue)
			}
		}
		out[path] = restored
	}
	// Ignored paths pass through untouched from the live state: undo must
	// neither revert them nor drop them from the replaced state.
	for (const [path, curField] of Object.entries(currentFields)) {
		if (isIgnored(path)) out[path] = curField
	}
	return out
}
