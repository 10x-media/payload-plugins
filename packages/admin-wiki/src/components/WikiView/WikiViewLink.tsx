'use client'

import { Button, useConfig } from '@payloadcms/ui'
import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { WikiEditModeToggle } from '../EditMode/WikiEditModeToggle'
import { BookIcon } from '../icons'
import './wiki-view.css'

/**
 * List-view actions on the wiki pages collection: the way into the wiki's own
 * reading view, plus the edit-mode switch, which belongs next to the guides it
 * governs.
 */
export const WikiViewLink = () => {
	const { config } = useConfig()
	const { t } = useTranslation()
	return (
		<span className="wiki-view-link">
			<WikiEditModeToggle />
			<Button
				buttonStyle="pill"
				el="link"
				icon={<BookIcon size="small" />}
				iconPosition="left"
				iconStyle="none"
				margin={false}
				size="small"
				to={`${config.routes.admin}/wiki`}
			>
				{t(keys.wikiOpenWiki)}
			</Button>
		</span>
	)
}
