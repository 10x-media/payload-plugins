import type { CollectionSlug } from 'payload'

import type { FileIconTypes } from './shared/fileIcons'
import type { TranslationsOption } from './translations'

/**
 * Where an upload collection's edit view shows its preview: a `drawer` opened
 * from a button beside the document controls, an `inline` panel above the
 * fields, or `both`.
 */
export type PreviewDisplay = 'both' | 'drawer' | 'inline'

/**
 * Viewer components keyed by mime pattern, an exact mime (`video/mp4`) or a
 * type wildcard (`video/*`). Values are Payload component paths
 * (`'/components/BunnyPlayer#BunnyPlayer'`) to client components receiving
 * `DocumentPreviewViewerProps`. Everything at a path is imported eagerly by the
 * admin import map, so a heavy viewer should lazy-load its own internals.
 */
export type ViewerOverrides = { [mimePattern: string]: string }

export type CollectionPreviewOptions = {
	/** Defaults to `'drawer'`. */
	display?: PreviewDisplay
	/**
	 * Give non-image files a file-type icon as their admin thumbnail (list
	 * column, upload fields, edit view) instead of Payload's blank page. On by
	 * default. Only fills an empty `thumbnailURL`, so image sizes, storage
	 * adapters and `upload.adminThumbnail` keep precedence. The icons are served
	 * to signed-in users only.
	 */
	fileIcons?: boolean
	/**
	 * Show `filesize` in the list view as `1.2 MB` rather than raw bytes. On by
	 * default; a `Cell` the collection already sets on `filesize` is kept.
	 */
	filesizeCell?: boolean
	/** Add a preview column to the list view. Off by default. */
	listView?: boolean
	/** Viewers for this collection only; they win over the global `viewers`. */
	viewers?: ViewerOverrides
}

export type FileIconsOptions = {
	/** Host icons by mime pattern (`model/gltf-binary`, `model/*`), checked before the built-ins. */
	types?: FileIconTypes
}

export type DocumentPreviewPluginOptions = {
	/**
	 * Upload collections that get previews. `true` takes the defaults, an object
	 * customizes. A collection that is missing or not an upload collection is a
	 * config error.
	 */
	collections: Partial<Record<CollectionSlug, CollectionPreviewOptions | true>>
	/**
	 * Disable the plugin entirely (incoming config returned untouched).
	 * Useful for opting out per environment without removing the plugin call.
	 */
	disabled?: boolean
	/**
	 * Default for every collection's `fileIcons`. `false` keeps Payload's own
	 * blank-page thumbnail everywhere unless a collection turns icons back on;
	 * an object turns them on and adds icons of the host's own, matched by mime
	 * before the built-in families:
	 *
	 * ```ts
	 * fileIcons: {
	 *   types: {
	 *     'model/*': { color: '#0EA5E9', label: '3D' },
	 *     'application/x-sketch': { svg: '<svg xmlns="http://www.w3.org/2000/svg" ...>' },
	 *   },
	 * }
	 * ```
	 */
	fileIcons?: boolean | FileIconsOptions
	/**
	 * Per-locale overrides for this plugin's UI strings, keyed by the typed
	 * translation keys exported from `@10x-media/document-preview/i18n`. Values win
	 * over the built-in locales key-by-key; locales the plugin does not ship are
	 * added whole. App-level `i18n.translations` still wins over both.
	 */
	translations?: TranslationsOption
	/** Viewers for every enabled collection; they win over the built-in viewers. */
	viewers?: ViewerOverrides
}

/** A collection's options with defaults applied. */
export type ResolvedCollectionPreview = {
	display: PreviewDisplay
	fileIcons: boolean
	filesizeCell: boolean
	listView: boolean
	viewers: ViewerOverrides
}
