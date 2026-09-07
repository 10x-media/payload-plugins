'use client'

import { useSettingsBadge, useSettingsItemState } from '@10x-media/settings-overlay/client'
import type { ManifestItem } from '@10x-media/settings-overlay/types'
import type React from 'react'

import { Pictogram } from './pictograms'

import './studio.css'

/**
 * A replaced rail row, drawing this project's own pictograms.
 *
 * The plugin renders one of these per item on the server and hands it `item`. Everything that
 * changes as the reader clicks around comes from `useSettingsItemState`, which is what keeps a
 * replacement from being a fork of the rail.
 */
export const StudioRailItem: React.FC<{ item: ManifestItem }> = ({ item }) => {
	const state = useSettingsItemState(item.slug)
	const badge = useSettingsBadge(item.slug)

	if (!state) {
		return null
	}

	return (
		<button
			aria-current={state.isActive ? 'page' : undefined}
			className={['studio-row', state.isActive && 'studio-row--active'].filter(Boolean).join(' ')}
			onClick={state.select}
			type="button"
		>
			<span className="studio-row__mark">
				<Pictogram slug={item.slug} />
			</span>
			<span className="studio-row__label">{item.label}</span>
			{badge === undefined ? null : <span className="studio-row__badge">{badge}</span>}
		</button>
	)
}
