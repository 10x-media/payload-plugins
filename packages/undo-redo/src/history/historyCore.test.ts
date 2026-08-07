import type { FormState } from 'payload'
import { describe, expect, it } from 'vitest'
import {
	buildRestoreState,
	canRedo,
	canUndo,
	createHistory,
	deepEqual,
	diffComparable,
	extractComparable,
	type HistoryEntry,
	isAtSavedState,
	MAX_HISTORY_ENTRIES,
	markSaved,
	pushSnapshot,
	type UndoHistory,
} from './historyCore'
import { createPathMatcher } from './pathPatterns'

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

	it("ignores Payload's own fields including nested ones", () => {
		const fields: FormState = {
			_status: textField('draft'),
			'sessions.0.expiresAt': textField('2026-01-01'),
			sessions: arrayField(['s1']),
			title: textField('Hello'),
		}
		const comparable = extractComparable(fields)
		expect(Object.keys(comparable)).toEqual(['title'])
	})

	it('keeps project fields that merely look derived', () => {
		const comparable = extractComparable({
			breadcrumbs: arrayField(['b1']),
			pathname: textField('/old'),
		})
		expect(Object.keys(comparable).sort()).toEqual(['breadcrumbs', 'pathname'])
	})

	it("does not create phantom entries when only Payload's own fields change", () => {
		const history = createHistory()
		pushSnapshot(history, { _status: textField('draft'), title: textField('x') })
		// Publishing rewrote _status, so there is no user-visible change.
		expect(pushSnapshot(history, { _status: textField('published'), title: textField('x') })).toBe(
			false
		)
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

	it('keeps changing the initialValue identity of a never-saved rich text field', () => {
		const lexical = (text: string) => ({
			root: { children: [{ text, type: 'paragraph' }], type: 'root' },
		})
		// Nothing was ever persisted here, so the live initialValue is nullish.
		// A primitive cannot be cloned into a new reference, yet restoring twice in
		// a row still has to look like two distinct initialValues to the editor.
		const richText = (value: unknown, initialValue: unknown): FormState[string] => ({
			initialValue,
			valid: true,
			value,
		})
		const history = createHistory()
		pushSnapshot(history, { content: richText(undefined, undefined) })
		pushSnapshot(history, { content: richText(lexical('typed'), undefined) })

		const undone = buildRestoreState(entryAt(history, 0), {
			content: richText(lexical('typed'), undefined),
		})
		expect(undone.content?.value).toBeUndefined()

		const redone = buildRestoreState(entryAt(history, 1), {
			content: richText(undefined, undone.content?.initialValue),
		})
		expect(redone.content?.value).toEqual(lexical('typed'))
		expect(Object.is(redone.content?.initialValue, undone.content?.initialValue)).toBe(false)
	})

	it("passes Payload's own fields through from the live state", () => {
		const history = createHistory()
		pushSnapshot(history, {
			_status: textField('draft'),
			sessions: arrayField(['s1']),
			title: textField('old'),
		})
		const currentSessions = arrayField(['s1', 's2'])
		const current: FormState = {
			_status: textField('published'),
			sessions: currentSessions,
			title: textField('new'),
		}
		const restored = buildRestoreState(entryAt(history, 0), current)
		expect(restored.title?.value).toBe('old')
		// Undoing an edit must not unpublish the document.
		expect(restored._status?.value).toBe('published')
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

describe('createSnapshot ids', () => {
	it('gives every snapshot a distinct id that survives cap eviction', () => {
		const history = createHistory()
		pushSnapshot(history, { title: textField('first') })
		const firstId = entryAt(history, 0).id
		for (let i = 0; i < MAX_HISTORY_ENTRIES + 5; i++) {
			pushSnapshot(history, { title: textField(`v${i}`) })
		}
		const ids = history.stack.map((entry) => entry.id)
		expect(new Set(ids).size).toBe(ids.length)
		// Eviction drops the front, so the surviving ids stay ascending and the
		// oldest survivor is no longer the entry this test started with.
		expect([...ids].sort((a, b) => a - b)).toEqual(ids)
		expect(entryAt(history, 0).id).toBeGreaterThan(firstId)
	})
})

describe('diffComparable', () => {
	it('reports changed, added and removed paths sorted by path', () => {
		const from = extractComparable({
			removed: textField('gone'),
			title: textField('old'),
			untouched: textField('same'),
		})
		const to = extractComparable({
			added: textField('new field'),
			title: textField('new'),
			untouched: textField('same'),
		})
		expect(diffComparable(from, to)).toEqual([
			{ path: 'added', from: undefined, to: 'new field', presence: 'added' },
			{ path: 'removed', from: 'gone', to: undefined, presence: 'removed' },
			{ path: 'title', from: 'old', to: 'new' },
		])
	})

	it('reports a row reorder as a row id change and nothing else', () => {
		const from = extractComparable({ items: arrayField(['r1', 'r2']) })
		const to = extractComparable({ items: arrayField(['r2', 'r1']) })
		// No `from`/`to`: a rows field contributes no comparable value.
		expect(diffComparable(from, to)).toEqual([
			{
				path: 'items',
				fromRowIds: ['r1', 'r2'],
				toRowIds: ['r2', 'r1'],
			},
		])
	})

	it('is empty for identical states', () => {
		const state = extractComparable({ items: arrayField(['r1']), title: textField('x') })
		expect(diffComparable(state, state)).toEqual([])
	})

	it('ignores the paths the history ignores', () => {
		const from = extractComparable({ title: textField('a'), updatedAt: textField('t1') })
		const to = extractComparable({ title: textField('a'), updatedAt: textField('t2') })
		expect(diffComparable(from, to)).toEqual([])
	})
})

describe('history options', () => {
	it('caps the stack at a custom maxHistory', () => {
		const history = createHistory({ maxHistory: 3 })
		for (let i = 0; i < 10; i++) pushSnapshot(history, { title: textField(`v${i}`) })
		expect(history.stack).toHaveLength(3)
		expect(entryAt(history, 2).comparable.title?.value).toBe('v9')
	})

	it('excludes paths matched by a custom matcher from capture', () => {
		const history = createHistory({ isIgnored: createPathMatcher(['list.*.rowRich']) })
		pushSnapshot(history, {
			'list.0.rowRich': textField('a'),
			'list.0.title': textField('one'),
		})
		expect(Object.keys(entryAt(history, 0).comparable)).toEqual(['list.0.title'])
	})

	it('creates no entry when only an excluded path changed', () => {
		const history = createHistory({ isIgnored: createPathMatcher(['slug']) })
		pushSnapshot(history, { slug: textField('a'), title: textField('x') })
		expect(pushSnapshot(history, { slug: textField('b'), title: textField('x') })).toBe(false)
	})

	it('passes excluded paths through untouched on restore', () => {
		const isIgnored = createPathMatcher(['slug'])
		const history = createHistory({ isIgnored })
		pushSnapshot(history, { slug: textField('old'), title: textField('old') })
		const current: FormState = { slug: textField('new'), title: textField('new') }
		const restored = buildRestoreState(entryAt(history, 0), current, isIgnored)
		expect(restored.title?.value).toBe('old')
		expect(restored.slug?.value).toBe('new')
	})

	it('still ignores Payload internals when no matcher is given', () => {
		const history = createHistory()
		pushSnapshot(history, { _status: textField('draft'), title: textField('x') })
		expect(Object.keys(entryAt(history, 0).comparable)).toEqual(['title'])
	})
})

describe('array and blocks value normalization', () => {
	/** A localized blocks field with no value in the active locale. */
	const emptyLocalizedBlocks = (): FormState[string] => ({
		initialValue: null,
		rows: [],
		valid: true,
		value: null,
	})

	/** The same field after Payload rebuilt form state and normalized it. */
	const normalizedEmptyBlocks = (): FormState[string] => ({
		initialValue: 0,
		rows: [],
		valid: true,
		value: 0,
	})

	it('treats the null to zero normalization as no change', () => {
		const history = createHistory()
		pushSnapshot(history, { sections: emptyLocalizedBlocks(), title: textField('a') })
		expect(
			pushSnapshot(history, { sections: normalizedEmptyBlocks(), title: textField('a') })
		).toBe(false)
		expect(history.stack).toHaveLength(1)
	})

	it('reports no diff for it, so the overlay stays truthful', () => {
		const from = extractComparable({ sections: emptyLocalizedBlocks() })
		const to = extractComparable({ sections: normalizedEmptyBlocks() })
		expect(diffComparable(from, to)).toEqual([])
	})

	it('does not let the normalization truncate the redo tail', () => {
		const history = createHistory()
		pushSnapshot(history, { sections: emptyLocalizedBlocks(), title: textField('a') })
		pushSnapshot(history, { sections: emptyLocalizedBlocks(), title: textField('ab') })
		// The user steps back, then the server merge answers with the normalized
		// field. Capturing that must not append an entry over the redo tail.
		history.index = 0
		expect(
			pushSnapshot(history, { sections: normalizedEmptyBlocks(), title: textField('a') })
		).toBe(false)
		expect(canRedo(history)).toBe(true)
		expect(history.stack).toHaveLength(2)
	})

	it('still detects real row changes', () => {
		const history = createHistory()
		pushSnapshot(history, { items: arrayField(['r1']) })
		expect(pushSnapshot(history, { items: arrayField(['r1', 'r2']) })).toBe(true)
		expect(pushSnapshot(history, { items: arrayField(['r2', 'r1']) })).toBe(true)
	})

	it('keeps comparing values for fields without rows', () => {
		const history = createHistory()
		pushSnapshot(history, { count: textField(null) })
		expect(pushSnapshot(history, { count: textField(0) })).toBe(true)
	})
})

describe('saved baseline', () => {
	it('starts with no baseline, so nothing reads as clean', () => {
		const history = createHistory()
		expect(history.savedComparable).toBeNull()
		expect(isAtSavedState(history)).toBe(false)
	})

	it('tracks the state the document was saved from', () => {
		const history = createHistory()
		const loaded: FormState = { title: textField('loaded') }
		pushSnapshot(history, loaded)
		markSaved(history, loaded)
		expect(isAtSavedState(history)).toBe(true)

		pushSnapshot(history, { title: textField('edited') })
		expect(isAtSavedState(history)).toBe(false)

		history.index = 0
		expect(isAtSavedState(history)).toBe(true)
	})

	it('reports clean at the save point, not at the first entry', () => {
		const history = createHistory()
		pushSnapshot(history, { title: textField('loaded') })
		const saved: FormState = { title: textField('edited') }
		pushSnapshot(history, saved)
		markSaved(history, saved)
		pushSnapshot(history, { title: textField('edited more') })

		history.index = 1
		expect(isAtSavedState(history)).toBe(true)
		// Back at the loaded state, which is no longer what is persisted.
		history.index = 0
		expect(isAtSavedState(history)).toBe(false)
	})

	it('records a save made while edits were still inside the capture debounce', () => {
		const history = createHistory()
		pushSnapshot(history, { title: textField('captured') })
		// The user typed on and hit save before the next capture ran.
		markSaved(history, { title: textField('typed then saved') })
		expect(isAtSavedState(history)).toBe(false)
		pushSnapshot(history, { title: textField('typed then saved') })
		expect(isAtSavedState(history)).toBe(true)
	})

	it('leaves the stack untouched, so redo onto the saved state survives', () => {
		const history = createHistory()
		const loaded: FormState = { title: textField('a') }
		pushSnapshot(history, loaded)
		markSaved(history, loaded)
		pushSnapshot(history, { title: textField('b') })
		pushSnapshot(history, { title: textField('c') })

		// Undo twice to the saved state, which makes the form clean and
		// re-records the baseline, then redo back up.
		history.index = 0
		expect(isAtSavedState(history)).toBe(true)
		markSaved(history, loaded)

		expect(history.stack).toHaveLength(3)
		expect(canRedo(history)).toBe(true)
		history.index = 1
		expect(entryAt(history, 1).comparable.title?.value).toBe('b')
		expect(entryAt(history, 2).comparable.title?.value).toBe('c')
	})

	it('survives eviction without renumbering, unlike an index would', () => {
		const history = createHistory({ maxHistory: 2 })
		const saved: FormState = { title: textField('a') }
		pushSnapshot(history, saved)
		markSaved(history, saved)
		pushSnapshot(history, { title: textField('b') })
		pushSnapshot(history, { title: textField('c') })
		// Entry 'a' was evicted, but the baseline is a value and still answers
		// correctly for any entry that matches it.
		expect(history.savedComparable).not.toBeNull()
		expect(isAtSavedState(history)).toBe(false)
		pushSnapshot(history, saved)
		expect(isAtSavedState(history)).toBe(true)
	})

	it('ignores the paths the history ignores', () => {
		const history = createHistory()
		const fields: FormState = { _status: textField('draft'), title: textField('a') }
		pushSnapshot(history, fields)
		markSaved(history, fields)
		// Publishing rewrites _status, which must not make the form look dirty.
		expect(isAtSavedState(history)).toBe(true)
	})
})

describe('volatile values', () => {
	/** Stands in for a JSON field: unparsed text is the field mid-edit. */
	const isVolatile = (path: string, field: FormState[string]): boolean => {
		if (path !== 'metadata' || typeof field.value !== 'string') return false
		try {
			JSON.parse(field.value)
			return false
		} catch {
			return true
		}
	}

	const withVolatile = (): UndoHistory => createHistory({ isVolatile })

	it('creates no entry when only a volatile path changed', () => {
		const history = withVolatile()
		pushSnapshot(history, { metadata: textField({ test: '123' }), title: textField('a') })
		expect(pushSnapshot(history, { metadata: textField('{"test":'), title: textField('a') })).toBe(
			false
		)
		expect(history.stack).toHaveLength(1)
	})

	it('captures the previous entry\u2019s value alongside a real edit', () => {
		const history = withVolatile()
		pushSnapshot(history, { metadata: textField({ test: '123' }), title: textField('a') })
		pushSnapshot(history, { metadata: textField('{"test":'), title: textField('b') })

		const entry = entryAt(history, 1)
		expect(entry.comparable.metadata?.value).toEqual({ test: '123' })
		expect(entry.fields.metadata?.value).toEqual({ test: '123' })
		expect(entry.comparable.title?.value).toBe('b')
	})

	it('falls back to the persisted value when there is no entry to carry from', () => {
		const history = withVolatile()
		pushSnapshot(history, { metadata: textField('{"test":', { test: 'saved' }) })
		expect(entryAt(history, 0).comparable.metadata?.value).toEqual({ test: 'saved' })
	})

	/**
	 * The failure this whole mechanism exists to prevent: an entry holding a
	 * value the restore cannot reproduce leaves the form in a state that differs
	 * from its own entry, and the next capture records that difference, appending
	 * a phantom entry and truncating the redo tail.
	 */
	it('leaves nothing pending after restoring an entry captured while volatile', () => {
		const history = withVolatile()
		pushSnapshot(history, { metadata: textField({ test: '123' }), title: textField('a') })
		pushSnapshot(history, { metadata: textField('{"test":'), title: textField('b') })

		const entry = entryAt(history, 1)
		const restored = buildRestoreState(entry, {
			metadata: textField('{"test":'),
			title: textField('b'),
		})
		history.index = 1
		expect(pushSnapshot(history, restored)).toBe(false)
		expect(history.stack).toHaveLength(2)
	})

	it('carries forward in the saved baseline too, so the marker stays reachable', () => {
		const history = withVolatile()
		const loaded: FormState = { metadata: textField({ test: '123' }), title: textField('a') }
		pushSnapshot(history, loaded)
		markSaved(history, { metadata: textField('{"test":'), title: textField('a') })
		expect(isAtSavedState(history)).toBe(true)
	})

	it('resumes capturing once the value parses again', () => {
		const history = withVolatile()
		pushSnapshot(history, { metadata: textField({ test: '123' }) })
		pushSnapshot(history, { metadata: textField('{"test":') })
		expect(pushSnapshot(history, { metadata: textField({ test: '456' }) })).toBe(true)
		expect(entryAt(history, 1).comparable.metadata?.value).toEqual({ test: '456' })
	})
})

describe('polymorphic relationship values', () => {
	const option = (extra: Record<string, unknown>) => ({
		relationTo: 'tags',
		value: 'tag-1',
		...extra,
	})

	it('ignores the label and permission members the admin field adds', () => {
		const history = createHistory()
		pushSnapshot(history, { mixed: textField([option({ label: 'alpha' })]) })
		expect(
			pushSnapshot(history, {
				mixed: textField([option({ allowEdit: true, label: 'alpha renamed' })]),
			})
		).toBe(false)
	})

	/**
	 * The server merge after a save replaces the whole option with the bare
	 * reference, which used to append an entry identical to the one before it.
	 */
	it('creates no entry when a save strips the options down to references', () => {
		const history = createHistory()
		pushSnapshot(history, {
			mixed: textField([option({ allowEdit: true, label: 'alpha' })]),
		})
		expect(pushSnapshot(history, { mixed: textField([option({})]) })).toBe(false)
	})

	it('still sees a changed target, a changed id and a changed order', () => {
		const history = createHistory()
		const a = option({ label: 'alpha' })
		const b = { label: 'a post', relationTo: 'posts', value: 'post-1' }
		pushSnapshot(history, { mixed: textField([a]) })
		expect(pushSnapshot(history, { mixed: textField([{ ...a, relationTo: 'posts' }]) })).toBe(true)
		expect(pushSnapshot(history, { mixed: textField([{ ...a, value: 'tag-2' }]) })).toBe(true)
		expect(pushSnapshot(history, { mixed: textField([a, b]) })).toBe(true)
		expect(pushSnapshot(history, { mixed: textField([b, a]) })).toBe(true)
	})

	it('normalizes a single (non-hasMany) polymorphic value too', () => {
		const history = createHistory()
		pushSnapshot(history, { primary: textField(option({ label: 'alpha' })) })
		expect(pushSnapshot(history, { primary: textField(option({})) })).toBe(false)
	})

	it('leaves values that are not references untouched', () => {
		const history = createHistory()
		// A single-target relationship stores bare ids, and arbitrary data has no
		// business being reduced to two of its keys.
		pushSnapshot(history, {
			data: textField({ relationTo: 'tags', value: { nested: 1 } }),
			tags: textField(['tag-1', 'tag-2']),
		})
		expect(
			pushSnapshot(history, {
				data: textField({ relationTo: 'tags', value: { nested: 2 } }),
				tags: textField(['tag-1', 'tag-2']),
			})
		).toBe(true)
	})
})

describe('server-filled paths', () => {
	/**
	 * Payload adds a row as a blank one and lets the debounced form-state request
	 * fill in its fields, so a capture can land between the two. That used to
	 * cost a second undo to get past a single click.
	 */
	it('folds a wave of pure additions into the current entry', () => {
		const history = createHistory()
		pushSnapshot(history, { blocks: arrayField([]), title: textField('a') })
		pushSnapshot(history, {
			blocks: arrayField(['row-1']),
			'blocks.0.blockType': textField('preset'),
			title: textField('a'),
		})
		expect(history.stack).toHaveLength(2)

		// The server's answer arrives with the row's own fields.
		expect(
			pushSnapshot(history, {
				blocks: arrayField(['row-1']),
				'blocks.0.blockType': textField('preset'),
				'blocks.0.preset': textField(undefined),
				title: textField('a'),
			})
		).toBe(false)
		expect(history.stack).toHaveLength(2)
		// Folded, not dropped: restoring this entry has to put the field back
		// rather than delete what Payload just filled in.
		expect(entryAt(history, 1).comparable).toHaveProperty(['blocks.0.preset'])
		expect(entryAt(history, 1).fields['blocks.0.preset']).toBeDefined()
	})

	it('leaves the entries before the current one alone', () => {
		const history = createHistory()
		pushSnapshot(history, { title: textField('a') })
		pushSnapshot(history, { title: textField('b') })
		expect(history.stack).toHaveLength(2)

		pushSnapshot(history, { extra: textField('x'), title: textField('b') })
		expect(history.stack).toHaveLength(2)
		expect(entryAt(history, 1).comparable).toHaveProperty(['extra'])
		// The fold lands on the current entry only. Stepping back has to reach the
		// state before the addition existed, not a rewritten version of it.
		expect(entryAt(history, 0).comparable.title?.value).toBe('a')
		expect(entryAt(history, 0).comparable).not.toHaveProperty(['extra'])
	})

	it('still appends when a value changed alongside the additions', () => {
		const history = createHistory()
		pushSnapshot(history, { title: textField('a') })
		expect(pushSnapshot(history, { extra: textField('x'), title: textField('b') })).toBe(true)
	})

	it('still appends when rows changed alongside the additions', () => {
		const history = createHistory()
		pushSnapshot(history, { list: arrayField([]) })
		expect(
			pushSnapshot(history, { list: arrayField(['r1']), 'list.0.word': textField(undefined) })
		).toBe(true)
	})

	/**
	 * A path holding `undefined` still occupies a key in the comparable state, so
	 * losing one is a removal like any other and must not read as "nothing that
	 * existed changed" just because both sides look empty.
	 */
	it('still appends when a path holding undefined disappeared alongside an addition', () => {
		const history = createHistory()
		pushSnapshot(history, { ghost: textField(undefined), title: textField('a') })
		expect(pushSnapshot(history, { extra: textField('x'), title: textField('a') })).toBe(true)
	})

	it('still appends when a path disappeared', () => {
		const history = createHistory()
		pushSnapshot(history, { hidden: textField('x'), title: textField('a') })
		expect(pushSnapshot(history, { title: textField('a') })).toBe(true)
	})

	it('does not fold a repeat of the same state', () => {
		const history = createHistory()
		pushSnapshot(history, { title: textField('a') })
		expect(pushSnapshot(history, { title: textField('a') })).toBe(false)
		expect(history.stack).toHaveLength(1)
	})
})
