import type {
	AdminWikiPluginOptions,
	WikiEditorBlockOption,
	WikiListBandOptions,
	WikiListBandSlot,
	WikiVideoOptions,
	WikiWriteAffordanceMode,
} from '../options'

/** Plugin options normalized to their effective values. */
export type ResolvedWikiOptions = {
	editorBlocks: WikiEditorBlockOption[]
	featured: boolean
	localeMap: Record<string, string>
	slugs: { media: string; pages: string }
	triggers: {
		edit: boolean
		exclude: string[]
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
export const resolveOptions = (options: AdminWikiPluginOptions): ResolvedWikiOptions => ({
	editorBlocks: options.editor?.blocks ?? [],
	featured: options.featured ?? true,
	localeMap: options.localeMap ?? {},
	slugs: {
		media: options.slugs?.media ?? 'wiki-media',
		pages: options.slugs?.pages ?? 'wiki-pages',
	},
	triggers: {
		edit: options.triggers?.edit ?? true,
		exclude: options.triggers?.exclude ?? [],
		global: options.triggers?.global ?? true,
		list: resolveListBand(options.triggers?.list),
	},
	video: options.video === true ? {} : (options.video ?? false),
	wikiView: options.wikiView ?? true,
	writeAffordances: options.writeAffordances ?? 'editMode',
})
