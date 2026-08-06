import type { FormState } from 'payload'

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
 * Field roots whose changes never create a history entry and that undo/redo
 * must never touch. These are system- or hook-managed and change on
 * save/autosave/token-refresh without user interaction, so treating them as
 * edits would create "phantom" history entries where undo appears to do
 * nothing, and restoring stale values for them could corrupt derived data
 * (pathname/breadcrumbs) or auth state (sessions).
 */
const IGNORED_ROOTS = new Set([
	'breadcrumbs',
	'createdAt',
	'hash',
	'lockUntil',
	'loginAttempts',
	'pathname',
	'resetPasswordExpiration',
	'resetPasswordToken',
	'salt',
	'sessions',
	'updatedAt',
])

/** True for paths the undo history ignores entirely (see IGNORED_ROOTS). */
export const isIgnoredPath = (path: string): boolean => {
	const dot = path.indexOf('.')
	return IGNORED_ROOTS.has(dot === -1 ? path : path.slice(0, dot))
}

export interface ComparableField {
	value: unknown
	/** Row ids in order, which captures array/blocks row additions, deletions and moves. */
	rowIds?: (string | undefined)[]
}

/** The slice of form state that counts as a user-visible edit. */
export type ComparableState = Record<string, ComparableField>

export interface HistoryEntry {
	fields: FormState
	comparable: ComparableState
}

export interface UndoHistory {
	stack: HistoryEntry[]
	/** Index of the entry representing the current form state. */
	index: number
}

export const MAX_HISTORY_ENTRIES = 50

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

export const extractComparable = (fields: FormState): ComparableState => {
	const out: ComparableState = {}
	for (const [path, field] of Object.entries(fields)) {
		if (isIgnoredPath(path) || !field) continue
		out[path] = extractComparableField(field)
	}
	return out
}

export const createSnapshot = (fields: FormState): HistoryEntry => ({
	fields: Object.fromEntries(Object.entries(fields).map(([path, field]) => [path, { ...field }])),
	comparable: extractComparable(fields),
})

export const createHistory = (): UndoHistory => ({ stack: [], index: -1 })

/**
 * Push the current form state onto the history. No-ops (and returns false) when
 * nothing user-visible changed relative to the entry at the current index,
 * which absorbs server-merge echoes after saves/restores. A real change drops
 * the redo tail, appends, and caps the stack at MAX_HISTORY_ENTRIES.
 */
export const pushSnapshot = (history: UndoHistory, fields: FormState): boolean => {
	const snapshot = createSnapshot(fields)
	const current = history.stack[history.index]
	if (current && deepEqual(current.comparable, snapshot.comparable)) return false
	history.stack.splice(history.index + 1)
	history.stack.push(snapshot)
	if (history.stack.length > MAX_HISTORY_ENTRIES) {
		history.stack.splice(0, history.stack.length - MAX_HISTORY_ENTRIES)
	}
	history.index = history.stack.length - 1
	return true
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
export const buildRestoreState = (snapshot: HistoryEntry, currentFields: FormState): FormState => {
	const out: FormState = {}
	for (const [path, snapField] of Object.entries(snapshot.fields)) {
		if (isIgnoredPath(path)) continue
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
	// System/derived fields pass through untouched from the live state: undo
	// must neither revert them nor drop them from the replaced state.
	for (const [path, curField] of Object.entries(currentFields)) {
		if (isIgnoredPath(path)) out[path] = curField
	}
	return out
}
