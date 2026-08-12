'use client'

import { Button, useConfig, useDocumentInfo } from '@payloadcms/ui'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { BookIcon } from '../icons'
import './wiki-view.css'

/**
 * The way from a guide being edited to how it reads in the wiki, beside the
 * document controls.
 *
 * Renders nothing until there is something to link to: the reading view serves
 * published guides only, and it resolves them by slug, so a draft-only guide or
 * one saved without a slug would land on "guide not found". The slug comes from
 * the saved document rather than the form, because an unsaved edit to it does
 * not exist at the other end of the link yet.
 */
export const WikiGuideViewLink = () => {
	const { t } = useTranslation()
	const { config } = useConfig()
	const { data, hasPublishedDoc } = useDocumentInfo()
	const slug = typeof data?.slug === 'string' ? data.slug : null

	if (!hasPublishedDoc || !slug) {
		return null
	}

	return (
		<Button
			buttonStyle="subtle"
			el="link"
			icon={<BookIcon />}
			iconPosition="left"
			iconStyle="none"
			margin={false}
			to={`${config.routes.admin}/wiki/${encodeURIComponent(slug)}`}
		>
			{t(keys.wikiOpenInWiki)}
		</Button>
	)
}
