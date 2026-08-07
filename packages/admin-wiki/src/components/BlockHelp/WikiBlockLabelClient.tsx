'use client'

import { blockTargetKey } from '../../shared/targetKeys'
import { WikiTargetHelp } from '../FieldHelp/WikiFieldHelp'
import './block-label.css'

export type WikiBlockLabelClientProps = {
	blockSlug: string
	rowLabel: null | string
}

/**
 * Client half of the injected block row label: reproduces the default label
 * text and appends the guide trigger for the block's target key. No write
 * affordance here; it would repeat on every row of the block type.
 */
export const WikiBlockLabelClient = ({ blockSlug, rowLabel }: WikiBlockLabelClientProps) => (
	<span className="wiki-block-label">
		<span className="wiki-block-label__text">{rowLabel ?? blockSlug}</span>
		<WikiTargetHelp showWriteAffordance={false} targetKey={blockTargetKey(blockSlug)} />
	</span>
)
