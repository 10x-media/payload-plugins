'use client'

import { Button } from '@payloadcms/ui'

import { keys } from '../../translations/keys'
import { useTranslation } from '../../translations/useTranslation'
import { BookIcon } from '../icons'
import { useWikiTargets } from '../WikiProvider/WikiProvider'
import './edit-mode.css'

/**
 * The wiki edit mode switch. Edit mode is what turns on the "write this guide"
 * affordances, which would otherwise sit next to every unguided field on every
 * edit view; it is per-browser and persists across reloads.
 *
 * Renders nothing unless the reader can author guides and the plugin is
 * configured for `writeAffordances: 'editMode'`; under `always` or `never`
 * there is nothing here to toggle.
 *
 * A secondary button that reads as selected while on, the way Payload's own
 * list "Filters" toggle shows its state. The label never changes width: "off"
 * is a quiet suffix rather than a different word.
 */
export const WikiEditModeToggle = () => {
	const { t } = useTranslation()
	const { editMode, setEditMode, writeAffordancesToggleable } = useWikiTargets()

	if (!writeAffordancesToggleable) {
		return null
	}

	return (
		<Button
			aria-label={t(keys.editModeTooltip)}
			aria-pressed={editMode}
			buttonStyle="secondary"
			className="wiki-edit-mode__toggle"
			icon={<BookIcon />}
			iconPosition="left"
			margin={false}
			onClick={() => setEditMode(!editMode)}
			selected={editMode}
			size="medium"
		>
			{t(keys.editModeLabel)}
			{editMode ? null : <span className="wiki-edit-mode__state">{t(keys.editModeOff)}</span>}
		</Button>
	)
}
