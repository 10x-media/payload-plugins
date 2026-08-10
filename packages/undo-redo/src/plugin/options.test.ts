import { describe, expect, it } from 'vitest'

import { DEFAULT_IGNORED_PATHS, MAX_HISTORY_ENTRIES } from '../history/historyCore'
import {
	DEFAULT_CAPTURE_DEBOUNCE_MS,
	DEFAULT_SHORTCUTS,
	resolveDocOptions,
	toClientProps,
	type UndoRedoPluginOptions,
} from './options'

const resolve = (options: UndoRedoPluginOptions, slug = 'posts') =>
	resolveDocOptions(options, 'collections', slug)

describe('resolveDocOptions defaults', () => {
	it('enables every collection with the documented defaults', () => {
		const resolved = resolve({})
		expect(resolved).toMatchObject({
			autoMount: true,
			debug: false,
			maxHistory: MAX_HISTORY_ENTRIES,
			captureDebounce: DEFAULT_CAPTURE_DEBOUNCE_MS,
			ignoreFieldTypes: [],
		})
		expect(resolved?.shortcuts).toEqual({
			undo: [...DEFAULT_SHORTCUTS.undo],
			redo: [...DEFAULT_SHORTCUTS.redo],
		})
	})

	it("always ignores Payload's own fields", () => {
		expect(resolve({})?.ignorePaths).toEqual([...DEFAULT_IGNORED_PATHS])
	})
})

describe('resolveDocOptions opt-out', () => {
	it('disables a single collection', () => {
		expect(resolve({ collections: { posts: false } })).toBeNull()
		expect(resolve({ collections: { posts: false } }, 'pages')).not.toBeNull()
	})

	it('disables every collection', () => {
		expect(resolve({ collections: false })).toBeNull()
	})

	it('scopes opt-out to its own kind of document', () => {
		const options: UndoRedoPluginOptions = { collections: false }
		expect(resolveDocOptions(options, 'collections', 'posts')).toBeNull()
		expect(resolveDocOptions(options, 'globals', 'posts')).not.toBeNull()
	})
})

describe('resolveDocOptions precedence', () => {
	it('lets a per-collection entry win over the top level', () => {
		const resolved = resolve({
			maxHistory: 100,
			debug: true,
			collections: { posts: { maxHistory: 10 } },
		})
		expect(resolved?.maxHistory).toBe(10)
		// Untouched keys still come from the top level.
		expect(resolved?.debug).toBe(true)
	})

	it('applies top-level settings to collections with no entry', () => {
		const resolved = resolve({ maxHistory: 100, collections: { pages: { maxHistory: 10 } } })
		expect(resolved?.maxHistory).toBe(100)
	})

	it('treats an explicit false as a value, not as "unset"', () => {
		const resolved = resolve({ autoMount: true, collections: { posts: { autoMount: false } } })
		expect(resolved?.autoMount).toBe(false)
	})

	it('merges ignorePaths across layers rather than replacing', () => {
		const resolved = resolve({
			ignorePaths: ['slug'],
			collections: { posts: { ignorePaths: ['readingTime'] } },
		})
		expect(resolved?.ignorePaths).toEqual([...DEFAULT_IGNORED_PATHS, 'slug', 'readingTime'])
	})

	it('deduplicates merged patterns', () => {
		const resolved = resolve({
			ignorePaths: ['slug'],
			collections: { posts: { ignorePaths: ['slug', 'updatedAt'] } },
		})
		expect(resolved?.ignorePaths.filter((path) => path === 'slug')).toHaveLength(1)
		expect(resolved?.ignorePaths.filter((path) => path === 'updatedAt')).toHaveLength(1)
	})

	it('merges ignoreFieldTypes across layers', () => {
		const resolved = resolve({
			ignoreFieldTypes: ['richText'],
			collections: { posts: { ignoreFieldTypes: ['point'] } },
		})
		expect(resolved?.ignoreFieldTypes).toEqual(['richText', 'point'])
	})
})

describe('resolveDocOptions shortcuts', () => {
	it('accepts a bare string as a single chord', () => {
		expect(resolve({ shortcuts: { undo: 'ctrl+u' } })?.shortcuts).toEqual({
			undo: ['ctrl+u'],
			redo: [...DEFAULT_SHORTCUTS.redo],
		})
	})

	it('accepts an array of chords', () => {
		expect(resolve({ shortcuts: { redo: ['ctrl+y', 'meta+y'] } })?.shortcuts).toEqual({
			undo: [...DEFAULT_SHORTCUTS.undo],
			redo: ['ctrl+y', 'meta+y'],
		})
	})

	it('turns keyboard handling off without disabling the buttons', () => {
		const resolved = resolve({ shortcuts: false })
		expect(resolved).not.toBeNull()
		expect(resolved?.shortcuts).toBe(false)
	})

	it('stays global, ignoring any per-collection entry', () => {
		const resolved = resolve({
			shortcuts: { undo: 'ctrl+u' },
			collections: { posts: { maxHistory: 5 } },
		})
		expect(resolved?.shortcuts).toEqual({
			undo: ['ctrl+u'],
			redo: [...DEFAULT_SHORTCUTS.redo],
		})
	})
})

describe('toClientProps', () => {
	it('drops the config-only settings', () => {
		const resolved = resolve({})
		if (!resolved) throw new Error('expected resolved options')
		expect(toClientProps(resolved)).not.toHaveProperty('autoMount')
		expect(toClientProps(resolved)).toHaveProperty('maxHistory')
	})

	it('produces props that survive the server to client boundary', () => {
		const resolved = resolve({ ignorePaths: ['slug'], ignoreFieldTypes: ['richText'] })
		if (!resolved) throw new Error('expected resolved options')
		const props = toClientProps(resolved)
		expect(JSON.parse(JSON.stringify(props))).toEqual(props)
	})
})
