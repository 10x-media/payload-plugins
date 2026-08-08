import type {
	AdminWikiPluginOptions,
	WikiEditorBlockOption,
	WikiEditTriggerSlot,
	WikiFeaturedSlot,
	WikiGlobalTriggerSlot,
	WikiListTriggerSlot,
	WikiVideoOptions,
	WikiWriteAffordanceMode,
} from '../options'

/** Plugin options normalized to their effective values. */
export type ResolvedWikiOptions = {
	editorBlocks: WikiEditorBlockOption[]
	featured: false | { slot: WikiFeaturedSlot }
	localeMap: Record<string, string>
	slugs: { media: string; pages: string }
	triggers: {
		edit: false | WikiEditTriggerSlot
		global: false | WikiGlobalTriggerSlot
		list: false | WikiListTriggerSlot
	}
	video: false | WikiVideoOptions
	wikiView: boolean
	writeAffordances: WikiWriteAffordanceMode
}

/** Apply defaults and normalize shorthand option forms. */
export const resolveOptions = (options: AdminWikiPluginOptions): ResolvedWikiOptions => ({
	editorBlocks: options.editor?.blocks ?? [],
	featured: options.featured === false ? false : { slot: options.featured?.slot ?? 'beforeList' },
	localeMap: options.localeMap ?? {},
	slugs: {
		media: options.slugs?.media ?? 'wiki-media',
		pages: options.slugs?.pages ?? 'wiki-pages',
	},
	triggers: {
		edit: options.triggers?.edit ?? 'beforeDocumentControls',
		global: options.triggers?.global ?? 'beforeDocumentControls',
		list: options.triggers?.list ?? 'actions',
	},
	video: options.video === true ? {} : (options.video ?? false),
	wikiView: options.wikiView ?? true,
	writeAffordances: options.writeAffordances ?? 'editMode',
})
