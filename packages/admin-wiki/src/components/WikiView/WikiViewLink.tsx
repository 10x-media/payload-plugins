'use client'

import { useConfig } from '@payloadcms/ui'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import './wiki-view.css'

/** List-view action on the wiki pages collection linking to the wiki index. */
export const WikiViewLink = () => {
	const { config } = useConfig()
	const { t } = useTranslation()
	return (
		<a className="wiki-view-link" href={`${config.routes.admin}/wiki`}>
			{t(keys.wikiOpenWiki)}
		</a>
	)
}
