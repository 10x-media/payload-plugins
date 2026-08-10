'use client'

import { blockTargetKey } from '../../shared/targetKeys'
import { WikiTargetHelp } from '../FieldHelp/WikiFieldHelp'
import './block-help.css'

export type WikiBlockHelpProps = {
	/** Injected client prop: the block's slug, keying `block:` guide targets. */
	blockSlug: string
}

/**
 * A block's guides, rendered as a UI field after the block's own fields.
 *
 * No write affordance: it would repeat on every row of the block type, and the
 * block's fields each carry their own. Renders nothing when no guide targets the
 * block, so an unguided block costs a row of nothing.
 */
export const WikiBlockHelp = ({ blockSlug }: WikiBlockHelpProps) => (
	<div className="wiki-block-help">
		<WikiTargetHelp showWriteAffordance={false} targetKey={blockTargetKey(blockSlug)} />
	</div>
)
