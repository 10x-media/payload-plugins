/**
 * Slugs and enums shared between server editor config and client renderers.
 * This module must stay free of server-only imports; the client bundle uses it.
 */
export const CALLOUT_BLOCK_SLUG = 'wikiCallout'

/** Lexical node type of the guide-to-guide link, an inline ElementNode wrapping its text. */
export const WIKI_GUIDE_LINK_NODE_TYPE = 'wikiGuideLink'

/** Lexical node type of the uploaded-video DecoratorNode. */
export const WIKI_VIDEO_NODE_TYPE = 'wikiVideo'

/** Slug of the external video embed block (YouTube / Vimeo by URL). */
export const VIDEO_EMBED_BLOCK_SLUG = 'wikiVideoEmbed'

export const CALLOUT_VARIANTS = ['info', 'tip', 'warning', 'danger'] as const

export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number]
