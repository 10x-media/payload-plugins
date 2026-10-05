import type { Config } from 'payload'

import type {
	DocumentPreviewPluginOptions,
	PreviewDisplay,
	ResolvedCollectionPreview,
	ViewerOverrides,
} from '../options'
import { isMimePattern } from '../shared/resolveViewer'
import type { DocumentPreviewRegistry } from './registry'

const DISPLAYS: ReadonlySet<PreviewDisplay> = new Set(['both', 'drawer', 'inline'])

const checkViewers = (viewers: undefined | ViewerOverrides, where: string): ViewerOverrides => {
	for (const pattern of Object.keys(viewers ?? {})) {
		if (!isMimePattern(pattern)) {
			throw new Error(
				`[document-preview] invalid viewer key "${pattern}" in ${where} (expected a lowercase mime like "video/mp4" or "video/*")`
			)
		}
	}
	return { ...viewers }
}

/**
 * Validate the options against the incoming config and fill defaults. Every
 * listed collection must exist and be an upload collection; a typo would
 * otherwise leave a collection silently without previews.
 */
export const normalizeOptions = (
	config: Config,
	options: DocumentPreviewPluginOptions
): DocumentPreviewRegistry => {
	const collections: Record<string, ResolvedCollectionPreview> = {}
	for (const [slug, value] of Object.entries(options.collections ?? {})) {
		if (!value) {
			continue
		}
		const collection = config.collections?.find((candidate) => candidate.slug === slug)
		if (!collection) {
			throw new Error(`[document-preview] collection "${slug}" is not in the config`)
		}
		if (!collection.upload) {
			throw new Error(`[document-preview] collection "${slug}" is not an upload collection`)
		}
		const custom = value === true ? {} : value
		const display = custom.display ?? 'drawer'
		if (!DISPLAYS.has(display)) {
			throw new Error(
				`[document-preview] invalid display "${String(display)}" for "${slug}" (expected "drawer", "inline" or "both")`
			)
		}
		collections[slug] = {
			display,
			filesizeCell: custom.filesizeCell !== false,
			listView: custom.listView === true,
			viewers: checkViewers(custom.viewers, `collections.${slug}.viewers`),
		}
	}
	return { collections, viewers: checkViewers(options.viewers, 'viewers') }
}
