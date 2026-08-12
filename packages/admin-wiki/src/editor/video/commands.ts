'use client'

import { createCommand, type LexicalCommand } from '@payloadcms/richtext-lexical/lexical'

import type { WikiVideoData } from './videoNode'

export const INSERT_WIKI_VIDEO_COMMAND: LexicalCommand<WikiVideoData> = createCommand(
	'INSERT_WIKI_VIDEO_COMMAND'
)

/**
 * Open the media picker. `replace` carries the node the picked document lands
 * on, which is how the card's swap action reuses the one drawer the plugin
 * hosts instead of opening a second one.
 */
export type OpenWikiVideoDrawerPayload = {
	replace: false | { nodeKey: string }
}

export const OPEN_WIKI_VIDEO_DRAWER_COMMAND: LexicalCommand<OpenWikiVideoDrawerPayload> =
	createCommand('OPEN_WIKI_VIDEO_DRAWER_COMMAND')
