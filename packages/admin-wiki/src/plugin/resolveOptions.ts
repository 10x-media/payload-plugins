import type { PayloadComponent } from 'payload'

import type {
	AdminWikiPluginOptions,
	WikiCustomTargetLabel,
	WikiCustomTargetOption,
	WikiEditorBlockOption,
	WikiEditorFeaturesOption,
	WikiListBandOptions,
	WikiListBandSlot,
	WikiVideoOptions,
	WikiViewOptions,
	WikiViewSlot,
	WikiWriteAffordanceMode,
} from '../options'
import { type ResolvedWikiExclude, resolveExcluded } from './exclude'

/** The wiki views registered, with every index slot present as an array. */
export type ResolvedWikiViewOptions = {
	components: Record<WikiViewSlot, PayloadComponent[]>
}

/** A declared custom target, deduplicated and always carrying a label. */
export type ResolvedWikiCustomTarget = {
	/** Bare key, without the `custom:` namespace the target keys carry. */
	key: string
	label: WikiCustomTargetLabel
}

/** Plugin options normalized to their effective values. */
export type ResolvedWikiOptions = {
	chips: { blocks: boolean }
	/** Host-declared surfaces, in declaration order. Empty when none were declared. */
	customTargets: ResolvedWikiCustomTarget[]
	editorBlocks: WikiEditorBlockOption[]
	/** Import-map path of the host's converters function; undefined when none. */
	editorConverters: string | undefined
	/**
	 * Left in whichever form the host gave it, array or function: normalizing the
	 * array into a function here would build the feature list at option-resolution
	 * time, and the list is only knowable once `buildWikiEditor` has assembled its
	 * own. `undefined` means the editor is the plugin's alone.
	 */
	editorFeatures: undefined | WikiEditorFeaturesOption
	editorInlineBlocks: WikiEditorBlockOption[]
	/**
	 * Slugs the plugin leaves untouched, per entity kind: Payload's internals,
	 * the wiki's own collections, and the host's `exclude` option.
	 */
	exclude: ResolvedWikiExclude
	featured: boolean
	localeMap: Record<string, string>
	slugs: { media: string; pages: string }
	triggers: {
		edit: boolean
		global: boolean
		list: false | { slot: WikiListBandSlot }
	}
	video: false | WikiVideoOptions
	wikiView: false | ResolvedWikiViewOptions
	writeAffordances: WikiWriteAffordanceMode
}

/** `true` is shorthand for the band at its default slot; `false` removes it. */
const resolveListBand = (
	list: boolean | undefined | WikiListBandOptions
): false | { slot: WikiListBandSlot } => {
	if (list === false) {
		return false
	}
	const slot = typeof list === 'object' ? list.slot : undefined
	return { slot: slot ?? 'afterListTable' }
}

/**
 * Normalize declared custom targets: string shorthand to an object, a key
 * written with the namespace already on it (`custom:dashboard`) back to the bare
 * one, blanks dropped, first declaration of a repeated key kept.
 */
const resolveCustomTargets = (
	targets: undefined | WikiCustomTargetOption[]
): ResolvedWikiCustomTarget[] => {
	const seen = new Set<string>()
	const resolved: ResolvedWikiCustomTarget[] = []
	for (const target of targets ?? []) {
		const declared = typeof target === 'string' ? { key: target, label: undefined } : target
		const key = declared.key?.trim().replace(/^custom:/, '')
		if (!key || seen.has(key)) {
			continue
		}
		seen.add(key)
		resolved.push({ key, label: declared.label ?? key })
	}
	return resolved
}

/** `true` and omission are the views without slot components; `false` skips them. */
const resolveWikiView = (
	wikiView: boolean | undefined | WikiViewOptions
): false | ResolvedWikiViewOptions => {
	if (wikiView === false) {
		return false
	}
	const components = typeof wikiView === 'object' ? wikiView.components : undefined
	return {
		components: {
			afterTable: components?.afterTable ?? [],
			beforeControls: components?.beforeControls ?? [],
			beforeTable: components?.beforeTable ?? [],
		},
	}
}

/** Apply defaults and normalize shorthand option forms. */
export const resolveOptions = (options: AdminWikiPluginOptions): ResolvedWikiOptions => {
	const slugs = {
		media: options.slugs?.media ?? 'wiki-media',
		pages: options.slugs?.pages ?? 'wiki-pages',
	}
	return {
		chips: { blocks: options.chips?.blocks ?? true },
		customTargets: resolveCustomTargets(options.customTargets),
		editorBlocks: options.editor?.blocks ?? [],
		editorConverters: options.editor?.converters,
		editorFeatures: options.editor?.features,
		editorInlineBlocks: options.editor?.inlineBlocks ?? [],
		exclude: resolveExcluded(options.exclude, slugs),
		featured: options.featured ?? true,
		localeMap: options.localeMap ?? {},
		slugs,
		triggers: {
			edit: options.triggers?.edit ?? true,
			global: options.triggers?.global ?? true,
			list: resolveListBand(options.triggers?.list),
		},
		video: options.video === true ? {} : (options.video ?? false),
		wikiView: resolveWikiView(options.wikiView),
		writeAffordances: options.writeAffordances ?? 'editMode',
	}
}
