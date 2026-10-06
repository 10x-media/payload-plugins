'use client'

import { useSettingsPanel } from '@10x-media/settings-overlay/client'
import { getTranslation } from '@payloadcms/translations'
import { useTranslation } from '@payloadcms/ui'
import type React from 'react'

import { Pictogram } from './pictograms'

import './studio.css'

/**
 * A replaced pane header: a breadcrumb instead of a bare title, and the back and close controls
 * the panel would otherwise draw itself.
 *
 * Everything it needs is on `useSettingsPanel()`, including `requestClose`, which asks before
 * discarding unsaved edits rather than closing outright. Replacing this slot means taking over
 * the delete button too, which this one deliberately leaves out to show that it can.
 */
export const StudioHeader: React.FC = () => {
	const { activeItem, canGoBack, goBack, overlay, requestClose } = useSettingsPanel()
	const { i18n } = useTranslation()

	return (
		<header className="studio-header">
			{canGoBack ? (
				<button className="studio-header__back" onClick={goBack} type="button">
					Back
				</button>
			) : null}
			<span className="studio-header__crumb">{getTranslation(overlay.label, i18n)}</span>
			<span className="studio-header__sep">/</span>
			{activeItem ? (
				<span className="studio-header__mark">
					<Pictogram slug={activeItem.slug} />
				</span>
			) : null}
			<h3 className="studio-header__title">{activeItem?.label ?? ''}</h3>
			<button
				aria-label="Close"
				className="studio-header__close"
				onClick={requestClose}
				type="button"
			>
				Esc
			</button>
		</header>
	)
}
