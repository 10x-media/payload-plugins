'use client'

import { createCommand, type LexicalCommand } from '@payloadcms/richtext-lexical/lexical'
import { createContext, useContext } from 'react'

import type { ComposerFeature, ComposerLabels, ComposerTranslate } from './types'

/** Open the link popover for the current selection. Handled by the link feature. */
export const OPEN_LINK_EDITOR_COMMAND: LexicalCommand<void> = createCommand('OPEN_LINK_EDITOR')

/** What the composer's plugins share: features, strings, where mentions search, open menus. */
export type ComposerRuntime = {
	features: ComposerFeature[]
	labels: ComposerLabels
	/** Where the mention typeahead searches; null turns it off. */
	mentions: { channel: string; conversationKey: string } | null
	/** A menu or popover that owns Enter reports itself here while open. */
	setOverlay: (name: string, open: boolean) => void
	t: ComposerTranslate
}

export const ComposerRuntimeContext = createContext<ComposerRuntime | null>(null)

export const useComposerRuntime = (): ComposerRuntime => {
	const runtime = useContext(ComposerRuntimeContext)
	if (!runtime) throw new Error('[@10x-media/conversations] composer plugin outside a composer')
	return runtime
}
