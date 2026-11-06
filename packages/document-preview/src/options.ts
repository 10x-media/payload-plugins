import type { CollectionSlug } from 'payload'

import type { FileIconTypes } from './shared/fileIcons'
import type { TranslationsOption } from './translations'

/**
 * Viewer components keyed by mime pattern, an exact mime (`video/mp4`) or a
 * type wildcard (`video/*`). Values are Payload component paths
 * (`'/components/BunnyPlayer#BunnyPlayer'`) to client components receiving
 * `DocumentPreviewViewerProps`. Everything at a path is imported eagerly by the
 * admin import map, so a heavy viewer should lazy-load its own internals.
 */
export type ViewerOverrides = { [mimePattern: string]: string }

export type CollectionPreviewOptions = {
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
	/** Add a preview column to the list view, opening the file in a drawer. Off by default. */
	listView?: boolean
	/**
	 * Leave images, video, audio and PDF to Payload's own previews in the edit
	 * view's file panel. On by default; `false` shows the plugin's viewers for
	 * them too (image zoom and pan, the too-large and failure cards, a link where
	 * the browser has no PDF viewer). A host viewer for one of these types always
	 * wins. The list drawer always uses the plugin's viewers.
	 */
	nativePreviews?: boolean
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
	/** Default for every collection's `nativePreviews`. */
	nativePreviews?: boolean
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
	fileIcons: boolean
	filesizeCell: boolean
	listView: boolean
	nativePreviews: boolean
	viewers: ViewerOverrides
}
