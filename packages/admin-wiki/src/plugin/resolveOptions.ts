import type {
	AdminWikiPluginOptions,
	WikiEditorBlockOption,
	WikiEditorFeaturesOption,
	WikiListBandOptions,
	WikiListBandSlot,
	WikiVideoOptions,
	WikiWriteAffordanceMode,
} from '../options'
import { type ResolvedWikiExclude, resolveExcluded } from './exclude'

/** Plugin options normalized to their effective values. */
export type ResolvedWikiOptions = {
	editorBlocks: WikiEditorBlockOption[]
	/**
	 * Left in whichever form the host gave it, array or function: normalizing the
	 * array into a function here would build the feature list at option-resolution
	 * time, and the list is only knowable once `buildWikiEditor` has assembled its
	 * own. `undefined` means the editor is the plugin's alone.
	 */
	editorFeatures: undefined | WikiEditorFeaturesOption
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
	wikiView: boolean
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

/** Apply defaults and normalize shorthand option forms. */
export const resolveOptions = (options: AdminWikiPluginOptions): ResolvedWikiOptions => {
	const slugs = {
		media: options.slugs?.media ?? 'wiki-media',
		pages: options.slugs?.pages ?? 'wiki-pages',
	}
	return {
		editorBlocks: options.editor?.blocks ?? [],
		editorFeatures: options.editor?.features,
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
		wikiView: options.wikiView ?? true,
		writeAffordances: options.writeAffordances ?? 'editMode',
	}
}
