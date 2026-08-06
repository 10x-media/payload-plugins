import type { FormState } from 'payload'
import { describe, expect, it } from 'vitest'

import {
	buildRestoreState,
	canRedo,
	canUndo,
	createHistory,
	deepEqual,
	extractComparable,
	type HistoryEntry,
	MAX_HISTORY_ENTRIES,
	pushSnapshot,
	type UndoHistory,
} from './historyCore'

const textField = (value: unknown, initialValue: unknown = value): FormState[string] => ({
	initialValue,
	valid: true,
	value,
})

const arrayField = (rowIds: string[]): FormState[string] => ({
	disableFormData: true,
	rows: rowIds.map((id) => ({ id })),
	valid: true,
	value: rowIds.length,
})

/** Narrows an entry the test just pushed, so assertions read without optional chains. */
const entryAt = (history: UndoHistory, index: number): HistoryEntry => {
	const entry = history.stack[index]
	if (!entry) throw new Error(`no history entry at ${index}`)
	return entry
}

describe('deepEqual', () => {
	it('compares primitives, arrays and objects structurally', () => {
		expect(deepEqual(1, 1)).toBe(true)
		expect(deepEqual('a', 'b')).toBe(false)
		expect(deepEqual([1, { a: 2 }], [1, { a: 2 }])).toBe(true)
		expect(deepEqual([1, 2], [2, 1])).toBe(false)
		expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
		expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true)
		expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
		expect(deepEqual(Number.NaN, Number.NaN)).toBe(true)
		expect(deepEqual(null, undefined)).toBe(false)
	})
})

describe('extractComparable', () => {
	it('captures values and row ids, ignores system paths', () => {
		const fields: FormState = {
			items: arrayField(['r1', 'r2']),
			title: textField('Hello'),
			updatedAt: textField('2026-01-01'),
		}
		const comparable = extractComparable(fields)
		expect(comparable.title).toEqual({ value: 'Hello' })
		expect(comparable.items?.rowIds).toEqual(['r1', 'r2'])
		expect(comparable.updatedAt).toBeUndefined()
	})

	it('ignores hook-derived and auth-managed paths including nested ones', () => {
		const fields: FormState = {
			'breadcrumbs.0.url': textField('/old'),
			breadcrumbs: arrayField(['b1']),
			pathname: textField('/old'),
			sessions: arrayField(['s1']),
			title: textField('Hello'),
		}
		const comparable = extractComparable(fields)
		expect(Object.keys(comparable)).toEqual(['title'])
	})

	it('does not create phantom entries when only derived fields change', () => {
		const history = createHistory()
		pushSnapshot(history, { pathname: textField('/a'), title: textField('x') })
		// Server merge recomputed pathname, so there is no user-visible change.
		expect(pushSnapshot(history, { pathname: textField('/b'), title: textField('x') })).toBe(false)
	})
})

describe('pushSnapshot', () => {
	it('dedupes states that are comparably identical', () => {
		const history = createHistory()
		expect(pushSnapshot(history, { title: textField('a') })).toBe(true)
		// Same value, different field-state object (e.g. a server-merge echo).
		expect(pushSnapshot(history, { title: { ...textField('a'), valid: true } })).toBe(false)
		expect(history.stack).toHaveLength(1)
	})

	it('records changes and tracks undo/redo availability', () => {
		const history = createHistory()
		pushSnapshot(history, { title: textField('a') })
		expect(canUndo(history)).toBe(false)
		pushSnapshot(history, { title: textField('ab') })
		expect(canUndo(history)).toBe(true)
		expect(canRedo(history)).toBe(false)
		history.index = 0
		expect(canRedo(history)).toBe(true)
	})

	it('truncates the redo tail when a new change arrives mid-history', () => {
		const history = createHistory()
		pushSnapshot(history, { title: textField('a') })
		pushSnapshot(history, { title: textField('b') })
		pushSnapshot(history, { title: textField('c') })
		history.index = 0
		pushSnapshot(history, { title: textField('x') })
		expect(history.stack.map((entry) => entry.fields.title?.value)).toEqual(['a', 'x'])
		expect(history.index).toBe(1)
		expect(canRedo(history)).toBe(false)
	})

	it('caps the stack at MAX_HISTORY_ENTRIES', () => {
		const history = createHistory()
		for (let i = 0; i <= MAX_HISTORY_ENTRIES + 10; i++) {
			pushSnapshot(history, { title: textField(`v${i}`) })
		}
		expect(history.stack).toHaveLength(MAX_HISTORY_ENTRIES)
		expect(history.index).toBe(MAX_HISTORY_ENTRIES - 1)
	})

	it('captures deleted array rows so undo can bring them back', () => {
		const history = createHistory()
		pushSnapshot(history, {
			items: arrayField(['r1', 'r2', 'r3']),
			'items.0.ean': textField('111'),
			'items.1.ean': textField('222'),
			'items.2.ean': textField('333'),
		})
		pushSnapshot(history, {
			items: arrayField(['r1', 'r3']),
			'items.0.ean': textField('111'),
			'items.1.ean': textField('333'),
		})
		expect(history.stack).toHaveLength(2)
		const before = entryAt(history, 0)
		expect(before.fields['items.2.ean']?.value).toBe('333')
		expect(before.comparable.items?.rowIds).toEqual(['r1', 'r2', 'r3'])
	})

	it('shields snapshots from later top-level mutation of live field state', () => {
		const history = createHistory()
		const live: FormState = { title: textField('a') }
		pushSnapshot(history, live)
		const title = live.title
		if (title) title.value = 'mutated'
		expect(entryAt(history, 0).fields.title?.value).toBe('a')
	})
})

describe('buildRestoreState', () => {
	it('restores snapshot values while keeping the live initialValue', () => {
		const history = createHistory()
		pushSnapshot(history, { title: textField('old', 'saved-old') })
		const current: FormState = { title: textField('new', 'saved-new') }
		const restored = buildRestoreState(entryAt(history, 0), current)
		expect(restored.title?.value).toBe('old')
		expect(restored.title?.initialValue).toBe('saved-new')
		expect(restored.title?.isModified).toBe(true)
	})

	it('does not flag unchanged fields as modified', () => {
		const history = createHistory()
		pushSnapshot(history, { subtitle: textField('same'), title: textField('old') })
		const current: FormState = { subtitle: textField('same'), title: textField('new') }
		const restored = buildRestoreState(entryAt(history, 0), current)
		expect(restored.title?.isModified).toBe(true)
		expect(restored.subtitle?.isModified).toBeUndefined()
	})

	it('drops fields that only exist in the live state (redo of a row deletion)', () => {
		const history = createHistory()
		pushSnapshot(history, {
			items: arrayField(['r1']),
			'items.0.ean': textField('111'),
		})
		const current: FormState = {
			items: arrayField(['r1', 'r2']),
			'items.0.ean': textField('111'),
			'items.1.ean': textField('222'),
		}
		const restored = buildRestoreState(entryAt(history, 0), current)
		expect(restored['items.1.ean']).toBeUndefined()
		expect(restored.items?.rows).toHaveLength(1)
	})

	it('gives changed rich text fields a fresh initialValue reference', () => {
		const lexical = (text: string) => ({
			root: { children: [{ text, type: 'paragraph' }], type: 'root' },
		})
		const initial = lexical('saved')
		const history = createHistory()
		pushSnapshot(history, { content: textField(lexical('old'), initial) })
		const current: FormState = { content: textField(lexical('new'), initial) }
		const restored = buildRestoreState(entryAt(history, 0), current)
		expect(restored.content?.value).toEqual(lexical('old'))
		// Same content as the live initialValue but a new reference, which is
		// what makes the mounted Lexical editor re-initialize.
		expect(restored.content?.initialValue).toEqual(initial)
		expect(restored.content?.initialValue).not.toBe(initial)
	})

	it('passes system/derived fields through from the live state', () => {
		const history = createHistory()
		pushSnapshot(history, {
			pathname: textField('/old-path'),
			sessions: arrayField(['s1']),
			title: textField('old'),
		})
		const currentSessions = arrayField(['s1', 's2'])
		const current: FormState = {
			pathname: textField('/new-path'),
			sessions: currentSessions,
			title: textField('new'),
		}
		const restored = buildRestoreState(entryAt(history, 0), current)
		expect(restored.title?.value).toBe('old')
		expect(restored.pathname?.value).toBe('/new-path')
		expect(restored.sessions).toBe(currentSessions)
	})

	it('restores deleted rows including their subfield state', () => {
		const history = createHistory()
		pushSnapshot(history, {
			items: arrayField(['r1', 'r2']),
			'items.0.ean': textField('111'),
			'items.1.ean': textField('222'),
		})
		const current: FormState = {
			items: arrayField(['r1']),
			'items.0.ean': textField('111'),
		}
		const restored = buildRestoreState(entryAt(history, 0), current)
		expect(restored.items?.rows).toHaveLength(2)
		expect(restored['items.1.ean']?.value).toBe('222')
		expect(restored['items.1.ean']?.isModified).toBe(true)
		expect(restored.items?.isModified).toBe(true)
	})
})
