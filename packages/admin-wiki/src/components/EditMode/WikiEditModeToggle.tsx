'use client'

import { Pill } from '@payloadcms/ui'

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
 * configured for `writeAffordances: 'editMode'` — under `always` or `never`
 * there is nothing here to toggle.
 *
 * The glyph rides inside the label rather than Pill's `icon` slot: that slot
 * zeroes the pill's gap and sizes icons to `--pill-icon-size`, which suits
 * Payload's own 20px chevrons and squashes a 12px one against the text.
 */
export const WikiEditModeToggle = () => {
	const { t } = useTranslation()
	const { editMode, setEditMode, writeAffordancesToggleable } = useWikiTargets()

	if (!writeAffordancesToggleable) {
		return null
	}

	return (
		<Pill
			aria-checked={editMode}
			aria-label={t(keys.editModeTooltip)}
			className="wiki-edit-mode__pill"
			onClick={() => setEditMode(!editMode)}
			pillStyle={editMode ? 'success' : 'light-gray'}
			size="small"
		>
			<BookIcon size="small" />
			{t(keys.editModeLabel)}
			{editMode ? null : <span className="wiki-edit-mode__state">{t(keys.editModeOff)}</span>}
		</Pill>
	)
}
