import type { Config } from 'payload'

import type {
	DocumentPreviewPluginOptions,
	PreviewDisplay,
	ResolvedCollectionPreview,
	ViewerOverrides,
} from '../options'
import { type CustomFileIcon, definitionSvg } from '../shared/fileIcons'
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

/** Validate host file icons and resolve each to its final markup. */
const checkFileIcons = (fileIcons: DocumentPreviewPluginOptions['fileIcons']): CustomFileIcon[] => {
	if (typeof fileIcons !== 'object') {
		return []
	}
	return Object.entries(fileIcons.types ?? {}).map(([pattern, definition]) => {
		const where = `fileIcons.types["${pattern}"]`
		if (!isMimePattern(pattern)) {
			throw new Error(
				`[document-preview] invalid mime pattern in ${where} (expected a lowercase mime like "model/gltf-binary" or "model/*")`
			)
		}
		if ('svg' in definition) {
			if (typeof definition.svg !== 'string' || !definition.svg.trim().startsWith('<svg')) {
				throw new Error(`[document-preview] ${where}.svg must be an SVG document`)
			}
		} else if (
			typeof definition.label !== 'string' ||
			!definition.label.trim() ||
			typeof definition.color !== 'string' ||
			!definition.color.trim()
		) {
			throw new Error(`[document-preview] ${where} needs a label and a color, or an svg`)
		}
		return { pattern, svg: definitionSvg(definition) }
	})
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
			fileIcons: custom.fileIcons ?? options.fileIcons !== false,
			filesizeCell: custom.filesizeCell !== false,
			listView: custom.listView === true,
			viewers: checkViewers(custom.viewers, `collections.${slug}.viewers`),
		}
	}
	return {
		collections,
		fileIcons: checkFileIcons(options.fileIcons),
		viewers: checkViewers(options.viewers, 'viewers'),
	}
}
