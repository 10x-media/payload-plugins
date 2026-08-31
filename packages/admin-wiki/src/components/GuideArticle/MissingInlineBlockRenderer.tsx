'use client'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'

/**
 * The inline counterpart of `MissingBlockRenderer`: a `<span>`, because an
 * inline block renders inside a paragraph and a block-level placeholder there is
 * invalid markup that React reports as a hydration error.
 */
export const MissingInlineBlockRenderer = ({ fields }: { fields: Record<string, unknown> }) => {
	const { t } = useTranslation()
	return (
		<span className="wiki-guide-article__missing-inline-block">
			{t(keys.missingBlockRenderer, {
				blockType: typeof fields.blockType === 'string' ? fields.blockType : 'unknown',
			})}
		</span>
	)
}
