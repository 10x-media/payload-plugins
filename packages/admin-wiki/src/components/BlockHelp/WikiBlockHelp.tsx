'use client'

import { blockTargetKey } from '../../shared/targetKeys'
import { WikiTargetHelp } from '../FieldHelp/WikiFieldHelp'
import { useWikiFieldPicker } from '../FieldPicker/WikiPickerContext'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './block-help.css'

export type WikiBlockHelpProps = {
	/** Injected client prop: the block's slug, keying `block:` guide targets. */
	blockSlug: string
}

/**
 * A block's guides, rendered as a UI field after the block's own fields.
 *
 * No write affordance: it would repeat on every row of the block type, and the
 * block's fields each carry their own. Renders nothing, wrapper included, when no
 * guide targets the block: an empty wrapper would still count for the
 * `:last-of-type` rule that drops the bottom margin of a block's closing group.
 *
 * Nothing inside the field picker either. The picker renders a block's own
 * fields to attach field targets to them, and this surface is about the
 * whole-block target, which the Blocks list on the same tab already owns.
 * Silencing it here rather than filtering the field out keeps the field indexes
 * the schema paths are computed from exactly as Payload built them.
 */
export const WikiBlockHelp = ({ blockSlug }: WikiBlockHelpProps) => {
	const picker = useWikiFieldPicker()
	const { entriesFor } = useWikiTargets()
	const targetKey = blockTargetKey(blockSlug)

	if (picker || entriesFor(targetKey).length === 0) {
		return null
	}

	return (
		<div className="wiki-block-help">
			<WikiTargetHelp showWriteAffordance={false} targetKey={targetKey} />
		</div>
	)
}
