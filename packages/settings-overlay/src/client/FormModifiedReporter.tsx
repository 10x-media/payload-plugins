'use client'

import { useDocumentInfo, useFormModified } from '@payloadcms/ui'
import type React from 'react'
import { useEffect } from 'react'

import { useSettingsOverlayEmbed, useSettingsOverlayOptional } from './context'

/**
 * Appended to `beforeDocumentControls` of every entity an overlay lists. Renders nothing.
 *
 * It lives inside the document form, which is the only place `useFormModified` answers, and
 * tells the provider so in-panel navigation can ask before discarding edits.
 *
 * The flag is global to the provider, so only the pane's own document may set it. A nested
 * document drawer opened from inside the pane, and any other page carrying this reporter, mount
 * their own copy and must not touch it. The embed context names the document the pane is
 * showing, and the report happens only when this copy sits in that document's form.
 *
 * Harmless on a normal page: with no panel open it reports nothing.
 */
export const SettingsFormModifiedReporter: React.FC = () => {
	const modified = useFormModified()
	const { collectionSlug, globalSlug, id } = useDocumentInfo()
	const overlay = useSettingsOverlayOptional()
	const embed = useSettingsOverlayEmbed()
	const setFormModified = overlay?.setFormModified

	const isPaneDocument = Boolean(
		embed &&
			(globalSlug
				? globalSlug === embed.itemSlug
				: collectionSlug === embed.itemSlug &&
					(embed.docID === 'new' ? !id : String(id) === embed.docID))
	)

	useEffect(() => {
		if (!isPaneDocument || !setFormModified) {
			return
		}
		setFormModified(modified)
		return () => {
			setFormModified(false)
		}
	}, [isPaneDocument, modified, setFormModified])

	return null
}
