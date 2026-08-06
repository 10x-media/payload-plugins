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
	value: unknown
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
 * Per-history settings. They live on the history object rather than being
 * threaded through every call so that a snapshot and the restore built from it
 * can never disagree about which paths are in scope.
 */
export interface HistoryOptions {
	/** Paths excluded from capture and from restore. */
	isIgnored: PathMatcher
	/** Entries kept before the oldest is evicted. */
	maxHistory: number
}

export interface UndoHistory {
	stack: HistoryEntry[]
	/** Index of the entry representing the current form state. */
	index: number
	options: HistoryOptions
}

export const DEFAULT_HISTORY_OPTIONS: HistoryOptions = {
	isIgnored: isIgnoredPath,
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

const extractComparableField = (field: FormState[string]): ComparableField => {
	const entry: ComparableField = { value: field.value }
	if (field.rows) entry.rowIds = field.rows.map((row) => row.id)
	return entry
}

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
	options: { ...DEFAULT_HISTORY_OPTIONS, ...options },
})

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
				// `?? null` keeps the reference change detectable even when the
				// live initialValue is undefined (never-saved rich text field).
				restored.initialValue = cloneJson(cur ? (cur.initialValue ?? null) : null)
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
