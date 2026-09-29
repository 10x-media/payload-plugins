import type { Block } from 'payload'

import { keys } from '../translations/keys'
import { labelForKey } from '../translations/server'

export const SCOPE_BLOCK_SLUG = 'contentLockScope'

/**
 * What the window freezes, as an inline block: the group, collection and
 * global labels in the viewer's language, or "all content". Follows the
 * window's scope, so changing it never leaves the text behind.
 */
export const scopeBlock: Block = {
	slug: SCOPE_BLOCK_SLUG,
	labels: {
		singular: labelForKey(keys.scopeBlockLabel),
		plural: labelForKey(keys.scopeBlockLabel),
	},
	fields: [],
}
