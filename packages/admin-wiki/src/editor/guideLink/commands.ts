'use client'

import {
	createCommand,
	type LexicalCommand,
	type LexicalNode,
} from '@payloadcms/richtext-lexical/lexical'

export type OpenWikiGuideLinkDrawerPayload = {
	/**
	 * The nodes the picked guide should be attached to, captured while the
	 * selection was still the author's. Both entry points hand these over: the
	 * toolbar captures the selection, the floating editor the link's own children.
	 */
	nodes: LexicalNode[]
}

export const OPEN_WIKI_GUIDE_LINK_DRAWER_COMMAND: LexicalCommand<OpenWikiGuideLinkDrawerPayload> =
	createCommand('OPEN_WIKI_GUIDE_LINK_DRAWER_COMMAND')
