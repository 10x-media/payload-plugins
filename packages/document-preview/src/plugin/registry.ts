import type { Config, SanitizedConfig } from 'payload'

import type { ResolvedCollectionPreview, ViewerOverrides } from '../options'
import type { CustomFileIcon } from '../shared/fileIcons'

export const REGISTRY_KEY = '@10x-media/document-preview'

/** What the plugin leaves in `config.custom` for its server provider to resolve. */
export type DocumentPreviewRegistry = {
	collections: Record<string, ResolvedCollectionPreview>
	/** Host file icons, resolved to markup, in match order. */
	fileIcons: CustomFileIcon[]
	viewers: ViewerOverrides
}

export const setRegistry = (config: Config, registry: DocumentPreviewRegistry): void => {
	config.custom ??= {}
	config.custom[REGISTRY_KEY] = registry
}

export const getRegistry = (
	config: Config | SanitizedConfig
): DocumentPreviewRegistry | undefined =>
	config.custom?.[REGISTRY_KEY] as DocumentPreviewRegistry | undefined
