import type { Field } from 'payload'

import { DEFAULT_IGNORED_PATHS, MAX_HISTORY_ENTRIES } from '../history/historyCore'
import type { TranslationsOption } from '../translations'

/**
 * Option shape and resolution. Kept free of Payload config plumbing so the
 * precedence rules are testable on their own: they are the part a host is most
 * likely to be surprised by.
 */

/** One or more `react-hotkeys-hook` chords, e.g. `'mod+z'` or `['mod+y', 'mod+shift+z']`. */
export type ShortcutKeys = string | string[]

/**
 * Settings a single collection or global can override.
 *
 * Declared as a type alias rather than an interface so it satisfies
 * `Record<string, unknown>`, which `definePlugin` constrains its options to.
 */
export type UndoRedoDocOptions = {
	/** Mount the history inspector overlay behind an extra toolbar button. */
	debug?: boolean
	/** Entries kept before the oldest is dropped. Defaults to 50. */
	maxHistory?: number
	/**
	 * Milliseconds of quiet before edits are captured as one entry. Raise it to
	 * coalesce more typing into a single undo step, lower it for finer steps.
	 */
	captureDebounce?: number
	/**
	 * Append the controls to the document controls automatically. Turn it off to
	 * place `<UndoRedoControls />` yourself in another admin slot.
	 */
	autoMount?: boolean
	/**
	 * Form-state paths to leave out of the history, as patterns where `*` matches
	 * one path segment: `slug`, `list.*.readingTime`. A pattern also covers
	 * everything below it. Merged with, never replacing, the fields Payload owns.
	 *
	 * Use this for fields you cannot edit the definition of; for your own fields
	 * prefer `admin.custom` on the field itself, which survives renames.
	 */
	ignorePaths?: string[]
	/** Field types to leave out of the history wherever they appear. */
	ignoreFieldTypes?: Field['type'][]
}

export type UndoRedoPluginOptions = UndoRedoDocOptions & {
	/** Disable the plugin entirely (incoming config returned untouched). */
	disabled?: boolean
	/**
	 * Keyboard chords, in `react-hotkeys-hook` syntax. `mod` resolves to Cmd on
	 * macOS and Ctrl elsewhere. Set to `false` to drop keyboard handling and keep
	 * the buttons.
	 *
	 * Deliberately global: shortcuts that change between collections are a way to
	 * confuse editors, not a feature.
	 */
	shortcuts?: false | { undo?: ShortcutKeys; redo?: ShortcutKeys }
	/**
	 * Per-collection settings. Undo/redo is on everywhere by default, so this is
	 * an opt-*out* map: `false` disables a collection, an object overrides the
	 * top-level settings for it. `collections: false` disables all of them.
	 */
	collections?: false | Record<string, false | UndoRedoDocOptions>
	/** Per-global settings, same shape as `collections`. */
	globals?: false | Record<string, false | UndoRedoDocOptions>
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/undo-redo/i18n`. Values win over
	 * the built-in locales key-by-key; locales the plugin does not ship are added
	 * whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
}

export const DEFAULT_CAPTURE_DEBOUNCE_MS = 400

export const DEFAULT_SHORTCUTS = {
	undo: ['mod+z'],
	redo: ['mod+shift+z', 'mod+y'],
} as const

/** Fully resolved settings for one collection or global. */
export interface ResolvedDocOptions {
	autoMount: boolean
	debug: boolean
	maxHistory: number
	captureDebounce: number
	ignorePaths: string[]
	ignoreFieldTypes: string[]
	shortcuts: false | { undo: string[]; redo: string[] }
}

/** The subset the client component needs, and all of it JSON-serializable. */
export type ControlsClientProps = Omit<ResolvedDocOptions, 'autoMount'>

const toArray = (keys: ShortcutKeys | undefined, fallback: readonly string[]): string[] =>
	keys === undefined ? [...fallback] : Array.isArray(keys) ? [...keys] : [keys]

const resolveShortcuts = (options: UndoRedoPluginOptions): ResolvedDocOptions['shortcuts'] => {
	if (options.shortcuts === false) return false
	return {
		undo: toArray(options.shortcuts?.undo, DEFAULT_SHORTCUTS.undo),
		redo: toArray(options.shortcuts?.redo, DEFAULT_SHORTCUTS.redo),
	}
}

export type DocScope = 'collections' | 'globals'

/**
 * Resolve the settings for one document type, or `null` when undo/redo is off
 * for it.
 *
 * Precedence is plugin defaults, then top-level options, then the per-slug
 * entry. `ignorePaths` and `ignoreFieldTypes` merge across those layers instead
 * of replacing: a collection adding one path should not silently drop the ones
 * declared globally, nor the fields Payload owns.
 */
export const resolveDocOptions = (
	options: UndoRedoPluginOptions,
	scope: DocScope,
	slug: string
): ResolvedDocOptions | null => {
	const scoped = options[scope]
	if (scoped === false) return null
	const entry = scoped?.[slug]
	if (entry === false) return null

	const layers: UndoRedoDocOptions[] = entry ? [options, entry] : [options]
	const pick = <K extends keyof UndoRedoDocOptions>(key: K): UndoRedoDocOptions[K] | undefined => {
		for (let i = layers.length - 1; i >= 0; i--) {
			const value = layers[i]?.[key]
			if (value !== undefined) return value
		}
		return undefined
	}

	return {
		autoMount: pick('autoMount') ?? true,
		debug: pick('debug') === true,
		maxHistory: pick('maxHistory') ?? MAX_HISTORY_ENTRIES,
		captureDebounce: pick('captureDebounce') ?? DEFAULT_CAPTURE_DEBOUNCE_MS,
		ignorePaths: [
			...new Set([...DEFAULT_IGNORED_PATHS, ...layers.flatMap((layer) => layer.ignorePaths ?? [])]),
		],
		ignoreFieldTypes: [...new Set(layers.flatMap((layer) => layer.ignoreFieldTypes ?? []))],
		shortcuts: resolveShortcuts(options),
	}
}

/** Strip the settings only the config layer uses, leaving the client's props. */
export const toClientProps = ({
	autoMount: _autoMount,
	...clientProps
}: ResolvedDocOptions): ControlsClientProps => clientProps
