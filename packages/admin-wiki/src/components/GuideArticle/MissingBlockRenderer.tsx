'use client'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'

/**
 * Visible placeholder for a consumer block whose renderer could not be
 * resolved: reads the slug from the node's own `blockType` field so broken
 * wiring is obvious instead of content silently vanishing.
 */
export const MissingBlockRenderer = ({ fields }: { fields: Record<string, unknown> }) => {
	const { t } = useTranslation()
	return (
		<p className="wiki-guide-article__missing-block">
			{t(keys.missingBlockRenderer, {
				blockType: typeof fields.blockType === 'string' ? fields.blockType : 'unknown',
			})}
		</p>
	)
}
